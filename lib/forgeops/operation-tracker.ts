export type OperationStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface OperationContext {
  operationId: string
  correlationId: string
  flowName: string
  entityType: string
  entityId?: string | null
  actorId?: string | null
  status: OperationStatus
  startedAt: string
  finishedAt?: string
  retryCount: number
  metadata: Record<string, unknown>
}

interface CreateOperationTrackerInput {
  flowName: string
  entityType: string
  entityId?: string | null
  actorId?: string | null
  operationId?: string | null
  correlationId?: string | null
  metadata?: Record<string, unknown>
  emit?: (eventName: string, payload: Record<string, unknown>) => void
}

const ALLOWED_TRANSITIONS: Record<OperationStatus, OperationStatus[]> = {
  pending: ['processing', 'failed'],
  processing: ['completed', 'failed'],
  completed: [],
  failed: [],
}

export function isValidOperationTransition(from: OperationStatus, to: OperationStatus) {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

function generateOperationId() {
  return crypto.randomUUID()
}

function sanitizeIncomingId(value?: string | null) {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : null
}

function toSafeErrorCode(error: unknown) {
  if (error instanceof Error && error.name) return error.name
  return 'OperationError'
}

function toSafeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message.slice(0, 300)
  return 'unknown_error'
}

export function createOperationTracker(input: CreateOperationTrackerInput) {
  const startedAt = new Date().toISOString()
  const operationId = sanitizeIncomingId(input.operationId) ?? generateOperationId()
  const correlationId = sanitizeIncomingId(input.correlationId) ?? operationId
  const emit = input.emit ?? (() => undefined)

  let context: OperationContext = {
    operationId,
    correlationId,
    flowName: input.flowName,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    actorId: input.actorId ?? null,
    status: 'pending',
    startedAt,
    retryCount: 0,
    metadata: input.metadata ?? {},
  }

  emit(`${context.flowName}.start`, {
    operationId: context.operationId,
    correlationId: context.correlationId,
    flow: context.flowName,
    status: context.status,
    timestamp: context.startedAt,
    entityType: context.entityType,
    entityId: context.entityId,
    actorId: context.actorId,
    retryCount: context.retryCount,
    ...context.metadata,
  })

  function transition(to: OperationStatus, metadata?: Record<string, unknown>) {
    if (!isValidOperationTransition(context.status, to)) {
      throw new Error(`Invalid operation transition: ${context.status} -> ${to}`)
    }

    const now = new Date().toISOString()
    context = {
      ...context,
      status: to,
      finishedAt: to === 'processing' ? undefined : now,
      metadata: {
        ...context.metadata,
        ...(metadata ?? {}),
      },
    }

    const eventName = to === 'processing' ? `${context.flowName}.processing` : `${context.flowName}.${to}`

    emit(eventName, {
      operationId: context.operationId,
      correlationId: context.correlationId,
      flow: context.flowName,
      status: context.status,
      timestamp: now,
      startedAt: context.startedAt,
      finishedAt: context.finishedAt,
      entityType: context.entityType,
      entityId: context.entityId,
      actorId: context.actorId,
      retryCount: context.retryCount,
      ...context.metadata,
    })

    return context
  }

  function fail(error: unknown, metadata?: Record<string, unknown>) {
    if (context.status === 'failed') return context
    if (context.status !== 'pending' && context.status !== 'processing') {
      throw new Error(`Cannot fail operation from status ${context.status}`)
    }

    const now = new Date().toISOString()
    context = {
      ...context,
      status: 'failed',
      finishedAt: now,
      metadata: {
        ...context.metadata,
        ...(metadata ?? {}),
      },
    }

    emit(`${context.flowName}.failed`, {
      operationId: context.operationId,
      correlationId: context.correlationId,
      flow: context.flowName,
      status: context.status,
      timestamp: now,
      startedAt: context.startedAt,
      finishedAt: context.finishedAt,
      entityType: context.entityType,
      entityId: context.entityId,
      actorId: context.actorId,
      retryCount: context.retryCount,
      errorCode: toSafeErrorCode(error),
      errorMessage: toSafeErrorMessage(error),
      ...context.metadata,
    })

    return context
  }

  return {
    getContext: () => context,
    toProcessing: (metadata?: Record<string, unknown>) => transition('processing', metadata),
    toCompleted: (metadata?: Record<string, unknown>) => transition('completed', metadata),
    fail,
  }
}
