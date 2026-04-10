// ═══════════════════════════════════════════════════════════════
// CONTRACTS: ZAEA — API pública do domínio de orquestração IA
// ═══════════════════════════════════════════════════════════════

/** Agentes disponíveis no sistema */
export type AgentName = 'orchestrator' | 'scanner' | 'surgeon' | 'validator' | 'zai' | 'sentinel'

/** Prioridade de tarefa */
export type TaskPriority = 'p0' | 'p1' | 'p2'

/** Status de execução de tarefa */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'escalated'

/** Tarefa de agente IA */
export interface AgentTask {
  id: string
  agent_name: AgentName
  status: TaskStatus
  priority: TaskPriority
  task_type: string
  input: Record<string, unknown>
  output?: Record<string, unknown>
  error_message?: string
  created_at: string
  updated_at: string
}

/** Input para criação de escalonamento */
export interface EscalationInput {
  restaurantId: string
  sessionId: string
  userMessage: string
  aiResponse: string
  reason: string
  metadata?: Record<string, unknown>
}

/** Registro de escalonamento salvo */
export interface Escalation extends EscalationInput {
  id: string
  resolved: boolean
  resolved_at?: string
  created_at: string
}

/** Entrada de aprendizado IA */
export interface LearningEntry {
  id: string
  question: string
  answer: string
  context?: string
  created_at: string
}

/** Métricas de aprendizado IA */
export interface AILearningMetrics {
  totalEscalations: number
  resolvedCount: number
  pendingCount: number
  resolutionRate: number
}

/** Maestro Agent — agentes conversacionais */
export type MaestroAgentName = 'zai-ia' | 'support' | 'prospecting' | 'direct-sales'

/** Contrato público do serviço ZAEA */
export interface IZaeaService {
  getTasksByAgent(agentName: AgentName): Promise<AgentTask[]>
  createEscalation(input: EscalationInput): Promise<Escalation>
  getLearningMetrics(): Promise<AILearningMetrics>
}
