/**
 * RAG and Summary adapter implementations.
 *
 * Request-scoped adapters wrapping vector store queries and conversation
 * summarization. Each call gets its own timeout and AbortSignal.
 */
import type {
  RAGProvider,
  RAGResult_,
  SummaryProvider,
  SummaryResult,
  Clock,
} from './dependency-ports'

// ── Fake RAG provider for testing ──────────────────────────────────────

export interface FakeRAGConfig {
  results?: Array<{ content: string; metadata?: Record<string, unknown> }>
  error?: { code: 'RAG_UNAVAILABLE' | 'RAG_TIMEOUT' | 'RAG_EMPTY_RESULT' | 'RAG_PROTOCOL_ERROR'; message: string }
  latencyMs?: number
}

export function createFakeRAGProvider(config: FakeRAGConfig = {}): RAGProvider {
  return {
    async search(_query: string, _limit: number, signal?: AbortSignal): Promise<RAGResult_> {
      if (config.latencyMs) {
        try {
          await new Promise((resolve, reject) => {
            const id = setTimeout(resolve, config.latencyMs)
            signal?.addEventListener('abort', () => {
              clearTimeout(id)
              reject(new DOMException('Aborted', 'AbortError'))
            })
          })
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            return { ok: false, error: { code: 'RAG_TIMEOUT', message: 'RAG request was aborted', retryable: true } }
          }
          throw err
        }
      }

      if (signal?.aborted) {
        return { ok: false, error: { code: 'RAG_TIMEOUT', message: 'RAG request was aborted', retryable: true } }
      }

      if (config.error) {
        const { code, message } = config.error
        return {
          ok: false,
          error: {
            code,
            message,
            retryable: code === 'RAG_UNAVAILABLE' || code === 'RAG_TIMEOUT',
          },
        }
      }

      if (config.results) {
        return { ok: true, results: config.results }
      }

      // Default: empty result (not an error — legitimately no matches)
      return { ok: true, results: [] }
    },
  }
}

// ── Fake Summary provider for testing ──────────────────────────────────

export interface FakeSummaryConfig {
  summary?: string
  error?: { code: 'SUMMARY_UNAVAILABLE' | 'SUMMARY_TIMEOUT' | 'SUMMARY_PROTOCOL_ERROR'; message: string }
  latencyMs?: number
}

export function createFakeSummaryProvider(config: FakeSummaryConfig = {}): SummaryProvider {
  return {
    async summarize(
      _messages: Array<{ role: string; content: string }>,
      signal?: AbortSignal,
    ): Promise<SummaryResult> {
      if (config.latencyMs) {
        try {
          await new Promise((resolve, reject) => {
            const id = setTimeout(resolve, config.latencyMs)
            signal?.addEventListener('abort', () => {
              clearTimeout(id)
              reject(new DOMException('Aborted', 'AbortError'))
            })
          })
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            return { ok: false, error: { code: 'SUMMARY_TIMEOUT', message: 'Summary aborted', retryable: true } }
          }
          throw err
        }
      }

      if (signal?.aborted) {
        return { ok: false, error: { code: 'SUMMARY_TIMEOUT', message: 'Summary aborted', retryable: true } }
      }

      if (config.error) {
        const { code, message } = config.error
        return {
          ok: false,
          error: {
            code,
            message,
            retryable: code === 'SUMMARY_TIMEOUT',
          },
        }
      }

      if (config.summary !== undefined) {
        return { ok: true, summary: config.summary }
      }

      return { ok: true, summary: 'No new information to summarize.' }
    },
  }
}
