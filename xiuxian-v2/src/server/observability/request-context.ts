/**
 * Immutable request context carrying correlation IDs, deadline,
 * AbortSignal, actor context, provider configuration, clock, and logger.
 *
 * Every request creates exactly one RequestContext. It is frozen on creation
 * and must not be mutated. All run-scoped data flows through this context.
 */
import { randomUUID } from 'crypto'

export interface RequestContextInput {
  requestId?: string
  runId?: string
  deadline: number
  abortSignal?: AbortSignal
  actorId?: string
  actorName?: string
  providerConfig?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface RequestContext {
  readonly requestId: string
  readonly runId: string
  readonly deadline: number
  readonly abortSignal: AbortSignal
  readonly actorId?: string
  readonly actorName?: string
  readonly createdAt: number
  readonly providerConfig: Readonly<Record<string, unknown>>
  readonly metadata: Readonly<Record<string, unknown>>
  isExpired(): boolean
}

export function createRequestContext(input: RequestContextInput): RequestContext {
  const requestId = input.requestId ?? randomUUID()
  const runId = input.runId ?? randomUUID()
  const createdAt = Date.now()
  const abortSignal = input.abortSignal ?? new AbortController().signal
  const providerConfig = deepFreeze({ ...input.providerConfig }) as Readonly<Record<string, unknown>>
  const metadata = deepFreeze({ ...input.metadata }) as Readonly<Record<string, unknown>>

  const ctx: RequestContext = Object.freeze({
    requestId,
    runId,
    deadline: input.deadline,
    abortSignal,
    actorId: input.actorId,
    actorName: input.actorName,
    createdAt,
    providerConfig,
    metadata,
    isExpired(): boolean {
      return Date.now() > this.deadline
    },
  })

  return ctx
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj
  Object.freeze(obj)
  for (const value of Object.values(obj as Record<string, unknown>)) {
    deepFreeze(value)
  }
  return obj
}
