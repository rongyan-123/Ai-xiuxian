/**
 * LLM adapter — request-scoped implementation of the LLMProvider port.
 *
 * Wraps fetch calls to OpenAI-compatible APIs with:
 * - Per-attempt timeout via AbortSignal
 * - Bounded transient retry with jitter
 * - Typed error classification
 * - Zero module-level mutable state
 */
import type {
  LLMProvider,
  LLMProviderConfig,
  LLMRequest,
  LLMResult,
  LLMResponse,
  LLMError,
  LLMErrorCode,
} from './dependency-ports'
import type { RetryPolicy, Clock } from './dependency-ports'

export interface LLMAdapterDeps {
  retryPolicy: RetryPolicy
  clock: Clock
  fetchFn?: typeof fetch
}

/**
 * Create a request-scoped LLM adapter.
 *
 * Configuration is passed per-request (via `complete`), never stored
 * at module level. Each call gets its own timeout and AbortSignal.
 */
export function createLLMAdapter(deps: LLMAdapterDeps): LLMProvider {
  const { retryPolicy, clock, fetchFn = fetch } = deps

  return {
    async complete(config: LLMProviderConfig, request: LLMRequest): Promise<LLMResult> {
      const timeoutMs = request.timeoutMs ?? 60000
      let lastError: LLMError | null = null

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

          // Link caller's signal
          if (request.signal) {
            if (request.signal.aborted) {
              clearTimeout(timeoutId)
              return {
                ok: false,
                error: {
                  code: 'LLM_ABORTED',
                  message: 'Request was aborted before sending',
                  retryable: false,
                },
              }
            }
            request.signal.addEventListener('abort', () => controller.abort())
          }

          try {
            const response = await fetchFn(`${config.baseUrl}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.apiKey}`,
              },
              body: JSON.stringify({
                model: config.modelName,
                messages: request.messages,
                tools: request.tools?.map((t) => ({
                  type: 'function',
                  function: t,
                })),
                temperature: config.temperature ?? 0.7,
                max_tokens: config.maxTokens,
              }),
              signal: controller.signal,
            })

            clearTimeout(timeoutId)

            if (!response.ok) {
              const error = classifyHttpError(response.status, response.statusText)
              lastError = error

              const retryDecision = retryPolicy.shouldRetry(error, attempt)
              if (!retryDecision.retry) return { ok: false, error }

              if (retryDecision.delayMs) {
                await sleep(retryDecision.delayMs)
              }
              continue
            }

            const body = await response.json() as Record<string, unknown>
            return {
              ok: true,
              response: parseLLMResponse(body),
            }
          } catch (err) {
            clearTimeout(timeoutId)

            // An AbortError means either timeout or caller cancellation
            const isAbortError =
              (err instanceof DOMException && err.name === 'AbortError') ||
              controller.signal.aborted

            if (isAbortError) {
              const error: LLMError = request.signal?.aborted
                ? { code: 'LLM_ABORTED', message: 'Request was cancelled', retryable: false }
                : { code: 'LLM_TIMEOUT', message: `LLM request timed out after ${timeoutMs}ms`, retryable: true }

              lastError = error
              const retryDecision = retryPolicy.shouldRetry(error, attempt)
              if (!retryDecision.retry) return { ok: false, error }
              if (retryDecision.delayMs) await sleep(retryDecision.delayMs)
              continue
            }

            // Network-level errors
            const error: LLMError = {
              code: 'LLM_CONNECTION_ERROR',
              message: err instanceof Error ? err.message : 'Unknown connection error',
              retryable: true,
              cause: err,
            }
            lastError = error
            const retryDecision = retryPolicy.shouldRetry(error, attempt)
            if (!retryDecision.retry) return { ok: false, error }
            if (retryDecision.delayMs) await sleep(retryDecision.delayMs)
          }
        } catch {
          // Outer catch for unexpected errors during retry logic
        }
      }

      return { ok: false, error: lastError ?? { code: 'LLM_SERVER_ERROR', message: 'Unknown error', retryable: false } }
    },
  }
}

// ── Error Classification ───────────────────────────────────────────────

function classifyHttpError(status: number, statusText: string): LLMError {
  switch (status) {
    case 401:
    case 403:
      return {
        code: 'LLM_AUTHENTICATION',
        message: `Authentication failed: ${statusText}`,
        retryable: false,
        statusCode: status,
      }
    case 429:
      return {
        code: 'LLM_RATE_LIMITED',
        message: `Rate limited: ${statusText}`,
        retryable: true,
        statusCode: status,
      }
    default:
      if (status >= 500) {
        return {
          code: 'LLM_SERVER_ERROR',
          message: `Server error ${status}: ${statusText}`,
          retryable: true,
          statusCode: status,
        }
      }
      return {
        code: 'LLM_SERVER_ERROR',
        message: `Unexpected status ${status}: ${statusText}`,
        retryable: false,
        statusCode: status,
      }
  }
}

// ── Response Parsing ──────────────────────────────────────────────────

function parseLLMResponse(body: Record<string, unknown>): LLMResponse {
  const choices = (body.choices as Array<Record<string, unknown>>) ?? []
  const firstChoice = choices[0]
  const message = (firstChoice?.message as Record<string, unknown>) ?? {}

  const content = (message.content as string) ?? null
  const rawToolCalls = (message.tool_calls as Array<Record<string, unknown>>) ?? []
  const toolCalls = rawToolCalls.map((tc) => {
    const fn = (tc.function as Record<string, unknown>) ?? {}
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse((fn.arguments as string) || '{}') as Record<string, unknown>
    } catch {
      // Malformed tool call arguments — include raw string for diagnostics
      args = { _raw: fn.arguments as string, _parse_error: true }
    }
    return {
      id: tc.id as string,
      name: fn.name as string,
      arguments: args,
    }
  })

  const usage = body.usage as Record<string, unknown> | undefined

  return {
    id: body.id as string,
    content,
    toolCalls,
    finishReason: (firstChoice?.finish_reason as string) ?? 'unknown',
    usage: usage ? {
      promptTokens: usage.prompt_tokens as number,
      completionTokens: usage.completion_tokens as number,
      totalTokens: usage.total_tokens as number,
    } : undefined,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
