import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/shared/supabase/admin'
import { requireAdmin } from '@/lib/domains/auth/admin-auth'

export const dynamic = 'force-dynamic'

// ── Schema ────────────────────────────────────────────────────────────────────
const LearnSchema = z.object({
  /** Descrição curta e única do padrão de erro */
  pattern: z.string().min(5).max(500),
  /** Categoria do erro */
  error_type: z.enum([
    'aria',
    'typescript',
    'powershell',
    'dockerfile',
    'markdown',
    'runtime',
    'custom',
  ]),
  /** Causa raiz do problema */
  root_cause: z.string().max(1000).optional(),
  /** Como foi resolvido (instrução para o Surgeon replicar) */
  solution: z.string().max(2000).optional(),
  /** Arquivos que precisaram ser alterados */
  files_changed: z.array(z.string().max(200)).max(20).optional().default([]),
  /** Regex ou grep-string que identifica este padrão no output do lint/tsc/build */
  detection_pattern: z.string().max(500).optional(),
  /** O ForgeOps pode corrigir isso automaticamente? */
  auto_fixable: z.boolean().optional().default(false),
  /** Confiança na solução (0–100) */
  confidence: z.number().int().min(0).max(100).optional().default(80),
  /** Quem resolveu: surgeon | human+copilot | auto | manual */
  resolved_by: z.string().max(50).optional().default('human+copilot'),
})

type LearnPayload = z.infer<typeof LearnSchema>

// ── Upsert na base de conhecimento ────────────────────────────────────────────
async function upsertKnowledge(entry: LearnPayload) {
  const supabase = createAdminClient()

  const { data: existing } = await supabase
    .from('agent_knowledge')
    .select('id, occurrences')
    .eq('pattern', entry.pattern)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('agent_knowledge')
      .update({
        root_cause: entry.root_cause ?? null,
        solution: entry.solution ?? null,
        files_changed: entry.files_changed,
        confidence: entry.confidence,
        outcome: 'success',
        occurrences: existing.occurrences + 1,
        last_seen_at: new Date().toISOString(),
        error_type: entry.error_type,
        resolved_by: entry.resolved_by,
        detection_pattern: entry.detection_pattern ?? null,
        auto_fixable: entry.auto_fixable,
      })
      .eq('id', existing.id)

    if (error) throw new Error(`Falha ao atualizar knowledge: ${error.message}`)
    return { id: existing.id as string, created: false, occurrences: existing.occurrences + 1 }
  }

  const { data, error } = await supabase
    .from('agent_knowledge')
    .insert({
      pattern: entry.pattern,
      root_cause: entry.root_cause ?? null,
      solution: entry.solution ?? null,
      files_changed: entry.files_changed,
      confidence: entry.confidence,
      outcome: 'success',
      error_type: entry.error_type,
      resolved_by: entry.resolved_by,
      detection_pattern: entry.detection_pattern ?? null,
      auto_fixable: entry.auto_fixable,
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(`Falha ao inserir knowledge: ${error?.message}`)
  return { id: data.id as string, created: true, occurrences: 1 }
}

// ── POST /api/agents/learn ────────────────────────────────────────────────────
// Registra um problema resolvido na base de conhecimento do ForgeOps.
// Aceita tanto INTERNAL_API_SECRET (GitHub Actions / scripts) quanto sessão admin.
export async function POST(req: NextRequest) {
  // Autenticação: aceita bearer interno OU sessão admin
  const authHeader = req.headers.get('authorization')
  const secret = process.env.INTERNAL_API_SECRET
  const isInternalToken = secret && authHeader === `Bearer ${secret}`

  if (!isInternalToken) {
    const admin = await requireAdmin(req, 'admin')
    if (!admin) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  // Suporte a upsert em lote (array) ou item único
  const isArray = Array.isArray(body)
  const items = isArray ? (body as unknown[]) : [body]

  const results: { id: string; created: boolean; occurrences: number; pattern: string }[] = []
  const errors: { index: number; error: string }[] = []

  for (let i = 0; i < items.length; i++) {
    const parsed = LearnSchema.safeParse(items[i])
    if (!parsed.success) {
      errors.push({ index: i, error: JSON.stringify(parsed.error.flatten()) })
      continue
    }

    try {
      const result = await upsertKnowledge(parsed.data)
      results.push({ ...result, pattern: parsed.data.pattern })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro interno'
      errors.push({ index: i, error: msg })
    }
  }

  const status = errors.length > 0 && results.length === 0 ? 422 : 201

  return NextResponse.json(
    {
      success: results.length > 0,
      recorded: results.length,
      errors: errors.length > 0 ? errors : undefined,
      results,
    },
    { status }
  )
}

// ── GET /api/agents/learn — consulta a base ───────────────────────────────────
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const secret = process.env.INTERNAL_API_SECRET
  const isInternalToken = secret && authHeader === `Bearer ${secret}`

  if (!isInternalToken) {
    const admin = await requireAdmin(req, 'admin')
    if (!admin) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }
  }

  const url = new URL(req.url)
  const errorType = url.searchParams.get('error_type')
  const autoFixable = url.searchParams.get('auto_fixable')
  const query = url.searchParams.get('q')
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 200)

  const supabase = createAdminClient()

  let q = supabase
    .from('agent_knowledge')
    .select(
      'id, pattern, error_type, root_cause, solution, files_changed, detection_pattern, auto_fixable, confidence, resolved_by, occurrences, outcome, last_seen_at, created_at'
    )
    .order('confidence', { ascending: false })
    .limit(limit)

  if (errorType) q = q.eq('error_type', errorType)
  if (autoFixable === 'true') q = q.eq('auto_fixable', true)
  if (query) q = q.ilike('pattern', `%${query}%`)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ knowledge: data ?? [], total: data?.length ?? 0 })
}
