/**
 * Dependency adapter tests (TDD: RED phase).
 *
 * Tests the infrastructure adapters: Clock, ID Generator, Retry Policy.
 * Also tests the LLM adapter error classification and retry behavior.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createClock,
  createFakeClock,
  createIdGenerator,
  createFakeIdGenerator,
  createRetryPolicy,
  createFakeRetryPolicy,
} from '@/server/infrastructure/adapters'
import type {
  Clock,
  IdGenerator,
  RetryPolicy,
  LLMError,
  RAGError,
  SummaryError,
} from '@/server/infrastructure/dependency-ports'

// ─── 7.1 Clock ────────────────────────────────────────────────────────────

describe('Clock adapter', () => {
  it('now() returns a number close to current time', () => {
    const clock = createClock()
    const t = clock.now()
    expect(typeof t).toBe('number')
    expect(t).toBeGreaterThan(1700000000000)
    expect(t).toBeLessThan(Date.now() + 1000)
  })

  it('iso() returns ISO 8601 string', () => {
    const clock = createClock()
    const iso = clock.iso()
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('deadline() returns a future timestamp', () => {
    const clock = createClock()
    const now = clock.now()
    const deadline = clock.deadline(5000)
    expect(deadline).toBe(now + 5000)
  })

  describe('FakeClock', () => {
    it('returns fixed initial timestamp', () => {
      const clock = createFakeClock(1000000)
      expect(clock.now()).toBe(1000000)
    })

    it('advance() moves time forward', () => {
      const clock = createFakeClock(1000)
      expect(clock.now()).toBe(1000)
      clock.advance(500)
      expect(clock.now()).toBe(1500)
      clock.advance(100)
      expect(clock.now()).toBe(1600)
    })

    it('iso() reflects current fake time', () => {
      const clock = createFakeClock(1700000000000)
      expect(clock.iso()).toContain('2023')
    })
  })
})

// ─── 7.1 ID Generator ────────────────────────────────────────────────────

describe('IdGenerator adapter', () => {
  it('generates unique request IDs', () => {
    const gen = createIdGenerator()
    const id1 = gen.requestId()
    const id2 = gen.requestId()
    expect(id1).not.toBe(id2)
    expect(id1).toContain('req-')
  })

  it('generates unique run IDs', () => {
    const gen = createIdGenerator()
    const id1 = gen.runId()
    const id2 = gen.runId()
    expect(id1).not.toBe(id2)
    expect(id1).toContain('run-')
  })

  it('generates unique idempotency keys', () => {
    const gen = createIdGenerator()
    const id1 = gen.idempotencyKey()
    const id2 = gen.idempotencyKey()
    expect(id1).not.toBe(id2)
    expect(id1).toContain('idem-')
  })

  it('uuid() returns a UUID', () => {
    const gen = createIdGenerator()
    const uuid = gen.uuid()
    expect(uuid).toMatch(/^[0-9a-f-]{36}$/)
  })

  describe('FakeIdGenerator', () => {
    let gen: ReturnType<typeof createFakeIdGenerator>

    beforeEach(() => {
      gen = createFakeIdGenerator()
    })

    it('generates sequential IDs', () => {
      expect(gen.requestId()).toBe('test-req-1')
      expect(gen.runId()).toBe('test-run-2')
      expect(gen.idempotencyKey()).toBe('test-idem-3')
    })

    it('reset() restarts counter', () => {
      gen.requestId()
      gen.requestId()
      gen.reset()
      expect(gen.requestId()).toBe('test-req-1')
    })
  })
})

// ─── 7.1 Retry Policy ────────────────────────────────────────────────────

describe('RetryPolicy', () => {
  const retryableError: LLMError = {
    code: 'LLM_RATE_LIMITED',
    message: 'Too many requests',
    retryable: true,
    statusCode: 429,
  }

  const nonRetryableError: LLMError = {
    code: 'LLM_AUTHENTICATION',
    message: 'Invalid API key',
    retryable: false,
    statusCode: 401,
  }

  describe('FakeRetryPolicy (deterministic)', () => {
    let policy: RetryPolicy

    beforeEach(() => {
      policy = createFakeRetryPolicy({ maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 30000 })
    })

    it('retries retryable errors within max attempts', () => {
      const r1 = policy.shouldRetry(retryableError, 1)
      expect(r1.retry).toBe(true)
      expect(r1.delayMs).toBe(1000) // baseDelay * 2^0

      const r2 = policy.shouldRetry(retryableError, 2)
      expect(r2.retry).toBe(true)
      expect(r2.delayMs).toBe(2000) // baseDelay * 2^1
    })

    it('stops retrying at maxAttempts', () => {
      const r = policy.shouldRetry(retryableError, 3)
      expect(r.retry).toBe(false)
    })

    it('never retries non-retryable errors', () => {
      const r = policy.shouldRetry(nonRetryableError, 1)
      expect(r.retry).toBe(false)
    })

    it('caps delay at maxDelayMs', () => {
      const p = createFakeRetryPolicy({ maxAttempts: 10, baseDelayMs: 1000, maxDelayMs: 5000 })
      const r = p.shouldRetry(retryableError, 5) // 2^4 * 1000 = 16000, capped at 5000
      expect(r.retry).toBe(true)
      expect(r.delayMs).toBe(5000)
    })

    it('exponential backoff pattern: 1s, 2s, 4s, 8s...', () => {
      const p = createFakeRetryPolicy({ maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 100000 })
      expect(p.shouldRetry(retryableError, 1).delayMs).toBe(1000)
      expect(p.shouldRetry(retryableError, 2).delayMs).toBe(2000)
      expect(p.shouldRetry(retryableError, 3).delayMs).toBe(4000)
      expect(p.shouldRetry(retryableError, 4).delayMs).toBe(8000)
    })
  })

  describe('Real RetryPolicy (with jitter)', () => {
    it('retry delay is within jitter range of base delay', () => {
      const policy = createRetryPolicy({ maxAttempts: 3, baseDelayMs: 1000, jitterFactor: 0.3 })
      // Run multiple times — all results should be within ±30% of 1000ms
      for (let i = 0; i < 20; i++) {
        const r = policy.shouldRetry(retryableError, 1)
        expect(r.retry).toBe(true)
        expect(r.delayMs!).toBeGreaterThanOrEqual(700)
        expect(r.delayMs!).toBeLessThanOrEqual(1300)
      }
    })
  })

  describe('RAG error retryability', () => {
    const ragUnavailable: RAGError = {
      code: 'RAG_UNAVAILABLE',
      message: 'Vector store down',
      retryable: true,
    }

    const ragProtocol: RAGError = {
      code: 'RAG_PROTOCOL_ERROR',
      message: 'Unexpected response format',
      retryable: false,
    }

    it('retries RAG_UNAVAILABLE', () => {
      const policy = createFakeRetryPolicy()
      expect(policy.shouldRetry(ragUnavailable, 1).retry).toBe(true)
    })

    it('does not retry RAG_PROTOCOL_ERROR', () => {
      const policy = createFakeRetryPolicy()
      expect(policy.shouldRetry(ragProtocol, 1).retry).toBe(false)
    })
  })

  describe('Summary error retryability', () => {
    const summaryTimeout: SummaryError = {
      code: 'SUMMARY_TIMEOUT',
      message: 'Summary timed out',
      retryable: true,
    }

    const summaryUnavailable: SummaryError = {
      code: 'SUMMARY_UNAVAILABLE',
      message: 'Summary service unavailable',
      retryable: false,
    }

    it('retries SUMMARY_TIMEOUT', () => {
      const policy = createFakeRetryPolicy()
      expect(policy.shouldRetry(summaryTimeout, 1).retry).toBe(true)
    })

    it('does not retry SUMMARY_UNAVAILABLE', () => {
      const policy = createFakeRetryPolicy()
      expect(policy.shouldRetry(summaryUnavailable, 1).retry).toBe(false)
    })
  })

  describe('custom retry config', () => {
    it('respects custom maxAttempts', () => {
      const policy = createFakeRetryPolicy({ maxAttempts: 5 })
      expect(policy.shouldRetry(retryableError, 4).retry).toBe(true)
      expect(policy.shouldRetry(retryableError, 5).retry).toBe(false)
    })

    it('respects custom baseDelayMs', () => {
      const policy = createFakeRetryPolicy({ baseDelayMs: 500 })
      expect(policy.shouldRetry(retryableError, 1).delayMs).toBe(500)
    })
  })
})
