/**
 * Forge — Orquestrador de Agentes de Engenharia (lib/orchestrator.ts)
 *
 * Parte do sistema ZAEA — Zairyx Autonomous Engineering Agent.
 *
 * ARQUITETURA DE ORQUESTRADORES:
 * ┌─────────────────────────────────────────────────────────┐
 * │  MAESTRO — Orquestra agentes de conversação e IA.      │
 * │  Controla: Zai IA, suporte, onboarding, prospecção.    │
 * │  Arquivo: lib/delivery-assistant.ts + /api/chat/        │
 * ├─────────────────────────────────────────────────────────┤
 * │  FORGE — Orquestra agentes de engenharia e DevOps.     │
 * │  Controla: Scanner, Surgeon, Validator, Sentinel.       │
 * │  Arquivo: lib/orchestrator.ts (ESTE ARQUIVO)            │
 * └─────────────────────────────────────────────────────────┘
 *
 * ROTEAMENTO DE IA (callForgeAI):
 * ┌──────────────────────────────────────────────────────────┐
 * │  [1] Vercel AI Gateway (vck_... — conta ZAEA)           │
 * │      → cache, logging, rate-limit, multi-provider        │
 * │      → https://ai-gateway.vercel.sh/v1/groq             │
 * │  [2] Groq direto (fallback automático)                   │
 * │      → https://api.groq.com/openai/v1                   │
 * └──────────────────────────────────────────────────────────┘
 *
 * Forge roda em: Vercel serverless, GitHub Actions (scanner 2h / health diário /
 * relatório semanal), Python backend.
 */

import { createAdminClient } from '@/lib/shared/supabase/admin'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type AgentName = 'orchestrator' | 'scanner' | 'surgeon' | 'validator' | 'zai' | 'sentinel'

export type TaskPriority = 'p0' | 'p1' | 'p2'

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'escalated'

export type KnowledgeOutcome = 'success' | 'failed' | 'escalated' | 'partial'

export interface AgentTask {
  id: string
  agent_name: AgentName
  status: TaskStatus
  priority: TaskPriority
  task_type: string
  input: Record<string, unknown>
  output: Record<string, unknown>
  error_message: string | null
  github_pr_url: string | null
  triggered_by: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export interface AgentKnowledge {
  id: string
  pattern: string
  root_cause: string | null
  solution: string | null
  files_changed: string[]
  confidence: number
  outcome: KnowledgeOutcome | null
  occurrences: number
  last_task_id: string | null
  created_at: string
  last_seen_at: string
}

export interface DispatchTaskParams {
  agent: AgentName
  taskType: string
  input?: Record<string, unknown>
  priority?: TaskPriority
  triggeredBy?: string
}

export interface RecordOutcomeParams {
  taskId: string
  status: TaskStatus
  output?: Record<string, unknown>
  errorMessage?: string | null
  githubPrUrl?: string | null
  /** Se fornecido, cria/atualiza entrada na base de conhecimento */
  knowledge?: {
    pattern: string
    rootCause?: string
    solution?: string
    filesChanged?: string[]
    confidence?: number
    outcome: KnowledgeOutcome
  }
}

// ── AI Gateway (FORGE) ────────────────────────────────────────────────────────

/**
 * Motor de IA do FORGE com roteamento inteligente:
 *  1. Tenta o Vercel AI Gateway (cache + logging + rate-limit)
 *  2. Faz fallback automático para Groq direto se o gateway falhar
 *
 * Usar em: Surgeon (geração de patches), Scanner (análise), Validator
 */
export async function callForgeAI(
  messages: { role: string; content: string }[],
  options?: {
    model?: string
    maxTokens?: number
    temperature?: number
    jsonMode?: boolean
  }
): Promise<string> {
  const model = options?.model ?? 'llama-3.3-70b-versatile'
  const maxTokens = options?.maxTokens ?? 1024
  const temperature = options?.temperature ?? 0.2

  const body = JSON.stringify({
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
    ...(options?.jsonMode ? { response_format: { type: 'json_object' } } : {}),
  })

  // ── Tentativa 1: Vercel AI Gateway ────────────────────────────────────────
  const gatewayToken = process.env.VERCEL_AI_GATEWAY_TOKEN
  if (gatewayToken) {
    try {
      const res = await fetch('https://ai-gateway.vercel.sh/v1/groq/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${gatewayToken}`,
          'Content-Type': 'application/json',
          'X-Vercel-AI-Gateway-Provider': 'groq',
        },
        body,
        signal: AbortSignal.timeout(45_000),
      })

      if (res.ok) {
        const data = (await res.json()) as { choices: { message: { content: string } }[] }
        const text = data?.choices?.[0]?.message?.content
        if (text) return text
      }
    } catch {
      // Gateway indisponível — cai no fallback
    }
  }

  // ── Fallback: Groq direto ─────────────────────────────────────────────────
  const groqKey = process.env.GROQ_API_KEY
  if (!groqKey)
    throw new Error(
      '[Forge] Nenhuma chave de IA disponível (VERCEL_AI_GATEWAY_TOKEN e GROQ_API_KEY ausentes)'
    )

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${groqKey}`,
      'Content-Type': 'application/json',
    },
    body,
    signal: AbortSignal.timeout(45_000),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`[Forge] Groq fallback falhou (${res.status}): ${err.slice(0, 200)}`)
  }

  const data = (await res.json()) as { choices: { message: { content: string } }[] }
  return data?.choices?.[0]?.message?.content ?? ''
}

// ── Core functions ────────────────────────────────────────────────────────────

/**
 * Cria uma nova tarefa na fila dos agentes.
 * Retorna o ID da tarefa criada.
 */
export async function dispatchTask(params: DispatchTaskParams): Promise<string> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('agent_tasks')
    .insert({
      agent_name: params.agent,
      task_type: params.taskType,
      input: params.input ?? {},
      priority: params.priority ?? 'p2',
      triggered_by: params.triggeredBy ?? 'api',
      status: 'pending',
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`[Orchestrator] Falha ao despachar tarefa: ${error?.message}`)
  }

  return data.id as string
}

/**
 * Marca tarefa como "running" com timestamp de início.
 */
export async function startTask(taskId: string): Promise<void> {
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('agent_tasks')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', taskId)

  if (error) throw new Error(`[Orchestrator] Falha ao iniciar tarefa ${taskId}: ${error.message}`)
}

/**
 * Registra o resultado de uma tarefa e opcionalmente alimenta a base de conhecimento.
 */
export async function recordOutcome(params: RecordOutcomeParams): Promise<void> {
  const supabase = createAdminClient()

  // 1. Atualiza a tarefa
  const { error: taskError } = await supabase
    .from('agent_tasks')
    .update({
      status: params.status,
      output: params.output ?? {},
      error_message: params.errorMessage ?? null,
      github_pr_url: params.githubPrUrl ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', params.taskId)

  if (taskError) {
    throw new Error(
      `[Orchestrator] Falha ao registrar outcome de ${params.taskId}: ${taskError.message}`
    )
  }

  // 2. Se veio conhecimento, faz upsert na base
  if (params.knowledge) {
    const k = params.knowledge

    // Busca entrada existente pelo padrão exato
    const { data: existing } = await supabase
      .from('agent_knowledge')
      .select('id, occurrences')
      .eq('pattern', k.pattern)
      .maybeSingle()

    if (existing) {
      await supabase
        .from('agent_knowledge')
        .update({
          root_cause: k.rootCause,
          solution: k.solution,
          files_changed: k.filesChanged ?? [],
          confidence: k.confidence ?? 50,
          outcome: k.outcome,
          occurrences: existing.occurrences + 1,
          last_task_id: params.taskId,
          last_seen_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
    } else {
      await supabase.from('agent_knowledge').insert({
        pattern: k.pattern,
        root_cause: k.rootCause,
        solution: k.solution,
        files_changed: k.filesChanged ?? [],
        confidence: k.confidence ?? 50,
        outcome: k.outcome,
        last_task_id: params.taskId,
      })
    }
  }
}

/**
 * Busca tarefa por ID.
 */
export async function getTask(taskId: string): Promise<AgentTask | null> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('agent_tasks')
    .select('*')
    .eq('id', taskId)
    .maybeSingle()

  if (error) throw new Error(`[Orchestrator] Falha ao buscar tarefa: ${error.message}`)
  return data as AgentTask | null
}

/**
 * Lista tarefas recentes (padrão: últimas 24h, máx 100).
 */
export async function listTasks(options?: {
  agent?: AgentName
  status?: TaskStatus
  limit?: number
  hoursBack?: number
}): Promise<AgentTask[]> {
  const supabase = createAdminClient()
  const limit = options?.limit ?? 50
  const hoursBack = options?.hoursBack ?? 24
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString()

  let query = supabase
    .from('agent_tasks')
    .select('*')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (options?.agent) query = query.eq('agent_name', options.agent)
  if (options?.status) query = query.eq('status', options.status)

  const { data, error } = await query
  if (error) throw new Error(`[Orchestrator] Falha ao listar tarefas: ${error.message}`)
  return (data ?? []) as AgentTask[]
}

/**
 * Busca entradas na base de conhecimento por texto (full-text search).
 */
export async function getKnowledge(pattern: string, limit = 5): Promise<AgentKnowledge[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('agent_knowledge')
    .select('*')
    .textSearch('pattern', pattern, { type: 'websearch', config: 'portuguese' })
    .order('confidence', { ascending: false })
    .limit(limit)

  if (error) {
    // Fallback: busca parcial por ILIKE caso o full-text falhe
    const { data: fallback } = await supabase
      .from('agent_knowledge')
      .select('*')
      .ilike('pattern', `%${pattern.slice(0, 50)}%`)
      .order('confidence', { ascending: false })
      .limit(limit)
    return (fallback ?? []) as AgentKnowledge[]
  }

  return (data ?? []) as AgentKnowledge[]
}

/**
 * Busca tarefas pendentes de alta prioridade (p0/p1) para execução imediata.
 */
export async function claimNextTask(agent: AgentName): Promise<AgentTask | null> {
  const supabase = createAdminClient()

  // Seleciona a tarefa pending de maior prioridade para o agente
  const { data, error } = await supabase
    .from('agent_tasks')
    .select('*')
    .eq('agent_name', agent)
    .eq('status', 'pending')
    .order('priority', { ascending: true }) // p0 < p1 < p2 alfabeticamente
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`[Orchestrator] Falha ao buscar próxima tarefa: ${error.message}`)
  if (!data) return null

  // Tenta reivindicar atomicamente (atualiza só se ainda pending)
  const { data: claimed, error: claimError } = await supabase
    .from('agent_tasks')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', data.id)
    .eq('status', 'pending') // condição de corrida: só atualiza se ainda pending
    .select('*')
    .maybeSingle()

  if (claimError)
    throw new Error(`[Orchestrator] Falha ao reivindicar tarefa: ${claimError.message}`)
  return claimed as AgentTask | null
}
