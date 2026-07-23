/**
 * LLM adapter tests (TDD: RED phase).
 *
 * Tests the LLMProvider adapter with a fake fetch to simulate:
 * - Success (content + tool calls)
 * - 401/403 authentication errors
 * - 429 rate limiting with retry
 * - 5xx server errors with retry
 * - Connection reset / network error
 * - Timeout
 * - Abort (caller cancellation)
 * - Empty response (no content, no tool calls)
 * - Malformed tool call arguments
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createLLMAdapter } from '@/server/infrastructure/llm-adapter'
import { createFakeRetryPolicy, createFakeClock } from '@/server/infrastructure/adapters'
import type {
  LLMProvider,
  LLMProviderConfig,
  LLMRequest,
} from '@/server/infrastructure/dependency-ports'

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<LLMProviderConfig> = {}): LLMProviderConfig {
  return {
    apiKey: 'sk-test-key',
    baseUrl: 'https://api.test.example',
    modelName: 'test-model',
    ...overrides,
  }
}

function makeRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  }
}

function makeSuccessBody(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'chatcmpl-001',
    object: 'chat.completion',
    created: 1700000000,
    model: 'test-model',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: 'Hello! How can I help?',
      },
      finish_reason: 'stop',
    }],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    },
    ...overrides,
  }
}

function makeToolCallBody(): Record<string, unknown> {
  return {
    id: 'chatcmpl-002',
    object: 'chat.completion',
    created: 1700000000,
    model: 'test-model',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_001',
          type: 'function',
          function: {
            name: 'Modify_Stats',
            arguments: '{"hp_change":-30}',
          },
        }],
      },
      finish_reason: 'tool_calls',
    }],
    usage: {
      prompt_tokens: 20,
      completion_tokens: 15,
      total_tokens: 35,
    },
  }
}

interface FakeResponse {
  status: number
  statusText: string
  body: Record<string, unknown> | string
}

function createFakeFetch(responses: FakeResponse[] | (() => FakeResponse)) {
  const responseFn = Array.isArray(responses)
    ? (() => responses.shift() ?? { status: 500, statusText: 'No more responses', body: {} })
    : responses

  return vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) => {
    const resp = responseFn()
    // Simulate network error
    if ((resp as unknown as { _throw: Error })._throw) {
      throw (resp as unknown as { _throw: Error })._throw
    }
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      statusText: resp.statusText,
      json: async () => typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body,
    } as Response
  })
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('7.2-7.3 LLM adapter', () => {
  let adapter: LLMProvider
  let clock: ReturnType<typeof createFakeClock>

  beforeEach(() => {
    clock = createFakeClock()
  })

  describe('success scenarios', () => {
    it('returns content from a successful response', async () => {
      const fetchFn = createFakeFetch([{
        status: 200, statusText: 'OK', body: makeSuccessBody(),
      }])
      adapter = createLLMAdapter({
        retryPolicy: createFakeRetryPolicy(),
        clock,
        fetchFn,
      })

      const result = await adapter.complete(makeConfig(), makeRequest())
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.response.content).toBe('Hello! How can I help?')
        expect(result.response.finishReason).toBe('stop')
        expect(result.response.usage?.promptTokens).toBe(10)
      }
    })

    it('parses tool calls from response', async () => {
      const fetchFn = createFakeFetch([{
        status: 200, statusText: 'OK', body: makeToolCallBody(),
      }])
      adapter = createLLMAdapter({
        retryPolicy: createFakeRetryPolicy(),
        clock,
        fetchFn,
      })

      const result = await adapter.complete(makeConfig(), makeRequest())
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.response.toolCalls).toHaveLength(1)
        expect(result.response.toolCalls[0].name).toBe('Modify_Stats')
        expect(result.response.toolCalls[0].arguments).toEqual({ hp_change: -30 })
      }
    })

    it('handles content=null with no tool calls', async () => {
      const fetchFn = createFakeFetch([{
        status: 200, statusText: 'OK',
        body: {
          id: 'chatcmpl-empty',
          choices: [{ index: 0, message: { role: 'assistant', content: null }, finish_reason: 'stop' }],
        },
      }])
      adapter = createLLMAdapter({
        retryPolicy: createFakeRetryPolicy(),
        clock,
        fetchFn,
      })

      const result = await adapter.complete(makeConfig(), makeRequest())
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.response.content).toBeNull()
        expect(result.response.toolCalls).toHaveLength(0)
      }
    })
  })

  describe('authentication errors (401/403)', () => {
    it('returns LLM_AUTHENTICATION for 401', async () => {
      const fetchFn = createFakeFetch([{
        status: 401, statusText: 'Unauthorized', body: { error: 'Invalid API key' },
      }])
      adapter = createLLMAdapter({
        retryPolicy: createFakeRetryPolicy(),
        clock,
        fetchFn,
      })

      const result = await adapter.complete(makeConfig(), makeRequest())
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('LLM_AUTHENTICATION')
        expect(result.error.retryable).toBe(false)
        expect(result.error.statusCode).toBe(401)
      }
    })

    it('returns LLM_AUTHENTICATION for 403', async () => {
      const fetchFn = createFakeFetch([{
        status: 403, statusText: 'Forbidden', body: {},
      }])
      adapter = createLLMAdapter({
        retryPolicy: createFakeRetryPolicy(),
        clock,
        fetchFn,
      })

      const result = await adapter.complete(makeConfig(), makeRequest())
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('LLM_AUTHENTICATION')
        expect(result.error.retryable).toBe(false)
      }
    })

    it('does not retry on 401', async () => {
      const fetchFn = vi.fn(async () => ({
        ok: false, status: 401, statusText: 'Unauthorized',
        json: async () => ({}),
      } as Response))

      adapter = createLLMAdapter({
        retryPolicy: createFakeRetryPolicy({ maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10 }),
        clock,
        fetchFn,
      })

      const result = await adapter.complete(makeConfig(), makeRequest())
      expect(result.ok).toBe(false)
      expect(fetchFn).toHaveBeenCalledTimes(1) // no retries
    })
  })

  describe('rate limiting (429)', () => {
    it('retries on 429 up to maxAttempts', async () => {
      const fetchFn = vi.fn(async () => ({
        ok: false, status: 429, statusText: 'Too Many Requests',
        json: async () => ({}),
      } as Response))

      adapter = createLLMAdapter({
        retryPolicy: createFakeRetryPolicy({ maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10 }),
        clock,
        fetchFn,
      })

      const result = await adapter.complete(makeConfig(), makeRequest())
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('LLM_RATE_LIMITED')
      expect(fetchFn).toHaveBeenCalledTimes(3) // original + 2 retries
    })
  })

  describe('server errors (5xx)', () => {
    it('returns LLM_SERVER_ERROR for 500', async () => {
      const fetchFn = createFakeFetch([{
        status: 500, statusText: 'Internal Server Error', body: {},
      }])
      adapter = createLLMAdapter({
        retryPolicy: createFakeRetryPolicy(),
        clock,
        fetchFn,
      })

      const result = await adapter.complete(makeConfig(), makeRequest())
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('LLM_SERVER_ERROR')
        expect(result.error.retryable).toBe(true)
        expect(result.error.statusCode).toBe(500)
      }
    })

    it('retries on 503 with backoff', async () => {
      let serverCalls = 0
      const fetchFn = vi.fn(async () => {
        serverCalls++
        if (serverCalls < 3) {
          return { ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({}) } as Response
        }
        return { ok: true, status: 200, statusText: 'OK', json: async () => makeSuccessBody() } as Response
      })

      adapter = createLLMAdapter({
        retryPolicy: createFakeRetryPolicy({ maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10 }),
        clock,
        fetchFn,
      })

      const result = await adapter.complete(makeConfig(), makeRequest())
      expect(result.ok).toBe(true)
      expect(fetchFn).toHaveBeenCalledTimes(3)
    })
  })

  describe('network errors', () => {
    it('returns LLM_CONNECTION_ERROR on fetch failure', async () => {
      const fetchFn = vi.fn(async () => {
        throw new Error('Connection reset')
      })

      adapter = createLLMAdapter({
        retryPolicy: createFakeRetryPolicy({ maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10 }),
        clock,
        fetchFn,
      })

      const result = await adapter.complete(makeConfig(), makeRequest())
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('LLM_CONNECTION_ERROR')
        expect(result.error.retryable).toBe(true)
      }
    })
  })

  describe('timeout', () => {
    it('returns LLM_TIMEOUT when request exceeds timeoutMs', async () => {
      const fetchFn = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
        // Simulate a timeout by triggering the abort
        const signal = init?.signal as AbortSignal | undefined
        // Don't abort immediately — the adapter handles it via setTimeout
        // We'll throw a DOMException to simulate the fetch abort
        const err = new DOMException('The operation was aborted', 'AbortError')
        throw err
      })

      adapter = createLLMAdapter({
        retryPolicy: createFakeRetryPolicy({ maxAttempts: 1 }),
        clock,
        fetchFn,
      })

      const result = await adapter.complete(makeConfig(), makeRequest({ timeoutMs: 100 }))
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('LLM_TIMEOUT')
      }
    })
  })

  describe('caller abort', () => {
    it('returns LLM_ABORTED when signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      const fetchFn = vi.fn()
      adapter = createLLMAdapter({
        retryPolicy: createFakeRetryPolicy(),
        clock,
        fetchFn,
      })

      const result = await adapter.complete(makeConfig(), makeRequest({ signal: controller.signal }))
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('LLM_ABORTED')
        expect(result.error.retryable).toBe(false)
      }
      expect(fetchFn).not.toHaveBeenCalled()
    })
  })

  describe('malformed tool calls', () => {
    it('handles tool call with invalid JSON gracefully', async () => {
      const fetchFn = createFakeFetch([{
        status: 200, statusText: 'OK',
        body: {
          id: 'chatcmpl-malformed',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'call_bad',
                type: 'function',
                function: {
                  name: 'Modify_Stats',
                  arguments: '{not valid json',
                },
              }],
            },
            finish_reason: 'tool_calls',
          }],
        },
      }])
      adapter = createLLMAdapter({
        retryPolicy: createFakeRetryPolicy(),
        clock,
        fetchFn,
      })

      const result = await adapter.complete(makeConfig(), makeRequest())
      expect(result.ok).toBe(true) // Response is still valid, malformed args captured
      if (result.ok) {
        expect(result.response.toolCalls[0].arguments._parse_error).toBe(true)
        expect(result.response.toolCalls[0].arguments._raw).toBe('{not valid json')
      }
    })
  })
})
