import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  dispatchTask,
  listTasks,
  getKnowledge,
  type AgentName,
  type TaskPriority,
} from '@/lib/domains/zaea/orchestrator'

export const dynamic = 'force-dynamic'

// ── Auth interna ───────────────────────────────────────────────────────────
function verifyInternalSecret(req: NextRequest): boolean {
  const auth = req.headers.get('authorization')
  const secret = process.env.INTERNAL_API_SECRET
  if (!secret) return false
  return auth === `Bearer ${secret}`
}

// ── Schemas ────────────────────────────────────────────────────────────────
const DispatchSchema = z.object({
  agent: z.enum(['orchestrator', 'scanner', 'surgeon', 'validator', 'zai', 'sentinel']),
  taskType: z.string().min(1).max(100),
  input: z.record(z.unknown()).optional().default({}),
  priority: z.enum(['p0', 'p1', 'p2']).optional().default('p2'),
  triggeredBy: z.string().max(50).optional(),
})

// ── POST /api/agents/dispatch — despacha nova tarefa ──────────────────────
export async function POST(req: NextRequest) {
  if (!verifyInternalSecret(req)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const parsed = DispatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Payload inválido', details: parsed.error.flatten() },
      { status: 422 }
    )
  }

  const { agent, taskType, input, priority, triggeredBy } = parsed.data

  try {
    const taskId = await dispatchTask({
      agent: agent as AgentName,
      taskType,
      input: input as Record<string, unknown>,
      priority: priority as TaskPriority,
      triggeredBy: triggeredBy ?? 'api',
    })

    return NextResponse.json({ success: true, taskId }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro interno'
    console.error('[agents/dispatch] POST error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── GET /api/agents/dispatch — lista tarefas + conhecimento ───────────────
export async function GET(req: NextRequest) {
  if (!verifyInternalSecret(req)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const url = new URL(req.url)
  const agent = url.searchParams.get('agent') as AgentName | null
  const status = url.searchParams.get('status') as string | null
  const hoursBack = Math.min(parseInt(url.searchParams.get('hours') ?? '24'), 168)
  const knowledgeQuery = url.searchParams.get('knowledge')

  try {
    const [tasks, knowledge] = await Promise.all([
      listTasks({
        agent: agent ?? undefined,
        status:
          (status as 'pending' | 'running' | 'completed' | 'failed' | 'escalated') ?? undefined,
        limit: 50,
        hoursBack,
      }),
      knowledgeQuery ? getKnowledge(knowledgeQuery, 10) : Promise.resolve([]),
    ])

    // Calcular stats resumidas
    const stats = {
      total: tasks.length,
      pending: tasks.filter((t) => t.status === 'pending').length,
      running: tasks.filter((t) => t.status === 'running').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      failed: tasks.filter((t) => t.status === 'failed').length,
      escalated: tasks.filter((t) => t.status === 'escalated').length,
    }

    return NextResponse.json({ tasks, knowledge, stats })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro interno'
    console.error('[agents/dispatch] GET error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
