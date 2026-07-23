/**
 * Minimal OpenTelemetry-compatible span instrumentation.
 *
 * Creates spans for HTTP, LLM, RAG, and database operations.
 * Sensitive attributes are automatically redacted.
 * Avoids external OTel SDK dependency for now — spans are
 * emitted through the centralized logger.
 */
import { randomUUID } from 'crypto'
import { redact } from './redaction'

export type SpanKind = 'http.server' | 'http.client' | 'llm' | 'database' | 'rag' | 'test'

export interface SpanInput {
  name: string
  attributes?: Record<string, unknown>
  parentSpanId?: string
  traceId?: string
}

export interface Span {
  readonly id: string
  readonly traceId: string
  readonly parentSpanId?: string
  readonly name: string
  readonly kind: SpanKind
  status: 'ok' | 'error'
  errorType?: string
  errorMessage?: string
  attemptCount: number
  durationMs?: number
  readonly attributes: Record<string, unknown>
  readonly startedAt: number
  setError(type: string, message: string): void
  incrementAttempt(): void
  end(): void
}

export function createSpan(kind: SpanKind, input: SpanInput): Span {
  const startedAt = Date.now()
  const traceId = input.traceId ?? randomUUID()

  // Redact sensitive attributes on creation
  const attributes = redact(input.attributes ?? {})

  return {
    id: randomUUID(),
    traceId,
    parentSpanId: input.parentSpanId,
    name: input.name,
    kind,
    status: 'ok',
    attemptCount: 1,
    attributes,
    startedAt,

    setError(type: string, message: string) {
      this.status = 'error'
      this.errorType = type
      this.errorMessage = message
    },

    incrementAttempt() {
      this.attemptCount++
    },

    end() {
      this.durationMs = Date.now() - this.startedAt
    },
  }
}
