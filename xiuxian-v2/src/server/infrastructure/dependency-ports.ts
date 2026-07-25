/**
 * Application ports for external dependencies.
 *
 * These interfaces define WHAT the application needs from infrastructure
 * (LLM, RAG, summary, clock, ID generation, event sink, retry policy).
 * Application code depends only on these ports, never on concrete implementations.
 */
import type { EnvelopeEvent } from '../streaming/event-factory'

export type { EnvelopeEvent }

// ── LLM Provider Port ──────────────────────────────────────────────────

export interface LLMProviderConfig {
  apiKey: string
  baseUrl: string
  modelName: string
  temperature?: number
  maxTokens?: number
}

export interface LLMRequest {
  messages: Array<{
    role: string
    content: string | null
    tool_calls?: Array<{
      id: string
      type: 'function'
      function: {
        name: string
        arguments: string
      }
    }>
    tool_call_id?: string
  }>
  tools?: Array<{
    name: string
    description: string
    parameters: Record<string, unknown>
  }>
  signal?: AbortSignal
  timeoutMs?: number
}

export interface LLMToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface LLMResponse {
  id: string
  content: string | null
  toolCalls: LLMToolCall[]
  finishReason: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

export type LLMErrorCode =
  | 'LLM_AUTHENTICATION'   // 401, 403
  | 'LLM_RATE_LIMITED'      // 429
  | 'LLM_SERVER_ERROR'      // 5xx
  | 'LLM_TIMEOUT'           // exceeded deadline
  | 'LLM_CONNECTION_ERROR'  // connection reset, DNS, etc.
  | 'LLM_EMPTY_RESPONSE'    // no content, no tool calls
  | 'LLM_MALFORMED_TOOLS'   // tool call JSON doesn't parse
  | 'LLM_ABORTED'           // caller cancelled

export interface LLMError {
  code: LLMErrorCode
  message: string
  retryable: boolean
  retryAfterMs?: number
  statusCode?: number
  cause?: unknown
}

export type LLMResult =
  | { ok: true; response: LLMResponse }
  | { ok: false; error: LLMError }

export interface LLMProvider {
  /** Send a chat completion request. Returns typed result or error. */
  complete(config: LLMProviderConfig, request: LLMRequest): Promise<LLMResult>
}

// ── RAG (Vector Store) Port ────────────────────────────────────────────

export interface RAGResult {
  content: string
  metadata?: Record<string, unknown>
}

export type RAGErrorCode =
  | 'RAG_UNAVAILABLE'
  | 'RAG_TIMEOUT'
  | 'RAG_EMPTY_RESULT'
  | 'RAG_PROTOCOL_ERROR'

export interface RAGError {
  code: RAGErrorCode
  message: string
  retryable: boolean
  cause?: unknown
}

export type RAGResult_ =
  | { ok: true; results: RAGResult[] }
  | { ok: false; error: RAGError }

export interface RAGProvider {
  search(query: string, limit: number, signal?: AbortSignal): Promise<RAGResult_>
}

// ── Summary Provider Port ──────────────────────────────────────────────

export type SummaryErrorCode =
  | 'SUMMARY_UNAVAILABLE'
  | 'SUMMARY_TIMEOUT'
  | 'SUMMARY_PROTOCOL_ERROR'

export interface SummaryError {
  code: SummaryErrorCode
  message: string
  retryable: boolean
  cause?: unknown
}

export type SummaryResult =
  | { ok: true; summary: string }
  | { ok: false; error: SummaryError }

export interface SummaryProvider {
  summarize(
    messages: Array<{ role: string; content: string }>,
    signal?: AbortSignal,
  ): Promise<SummaryResult>
}

// ── Event Sink (SSE Output) Port ──────────────────────────────────────

export interface EventSink {
  /** Emit a domain event to the SSE stream. */
  emit(event: EnvelopeEvent): void

  /** Complete the stream successfully. */
  complete(): void

  /** Fail the stream with an error. */
  fail(error: { code: string; message: string; retryable: boolean }): void

  /** Cancel the stream (caller disconnected). */
  cancel(reason?: string): void
}

// ── Clock Port ────────────────────────────────────────────────────────

export interface Clock {
  now(): number
  iso(): string
  deadline(ms: number): number
}

// ── ID Generator Port ─────────────────────────────────────────────────

export interface IdGenerator {
  requestId(): string
  runId(): string
  idempotencyKey(): string
  uuid(): string
}

// ── Retry Policy Port ─────────────────────────────────────────────────

export interface RetryConfig {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  jitterFactor: number // 0-1, fraction of delay to jitter
}

export interface RetryPolicy {
  /** Determine if and when to retry based on the error and attempt number. */
  shouldRetry(error: LLMError | RAGError | SummaryError, attempt: number): {
    retry: boolean
    delayMs?: number
  }
}
