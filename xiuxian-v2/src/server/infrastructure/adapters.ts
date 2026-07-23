/**
 * Concrete implementations of infrastructure dependency ports.
 *
 * - Clock: wraps Date.now / Date.prototype.toISOString
 * - IdGenerator: UUID-based, with optional prefix overrides
 * - RetryPolicy: exponential backoff with jitter
 */
import type { Clock, IdGenerator, RetryPolicy, RetryConfig } from './dependency-ports'

// ── Clock ──────────────────────────────────────────────────────────────

export function createClock(): Clock {
  return {
    now(): number {
      return Date.now()
    },
    iso(): string {
      return new Date().toISOString()
    },
    deadline(ms: number): number {
      return Date.now() + ms
    },
  }
}

/** Deterministic clock for testing. */
export function createFakeClock(initialMs = 1700000000000): Clock & { advance(ms: number): void } {
  let current = initialMs
  return {
    now(): number {
      return current
    },
    iso(): string {
      return new Date(current).toISOString()
    },
    deadline(ms: number): number {
      return current + ms
    },
    advance(ms: number): void {
      current += ms
    },
  }
}

// ── ID Generator ──────────────────────────────────────────────────────

export function createIdGenerator(prefix = ''): IdGenerator {
  return {
    requestId(): string {
      return `${prefix}req-${crypto.randomUUID()}`
    },
    runId(): string {
      return `${prefix}run-${crypto.randomUUID()}`
    },
    idempotencyKey(): string {
      return `${prefix}idem-${crypto.randomUUID()}`
    },
    uuid(): string {
      return crypto.randomUUID()
    },
  }
}

/** Deterministic ID generator for testing. */
export function createFakeIdGenerator(prefix = 'test-'): IdGenerator & { reset(): void } {
  let counter = 0
  return {
    requestId(): string {
      return `${prefix}req-${++counter}`
    },
    runId(): string {
      return `${prefix}run-${++counter}`
    },
    idempotencyKey(): string {
      return `${prefix}idem-${++counter}`
    },
    uuid(): string {
      return `${prefix}uuid-${++counter}`
    },
    reset(): void {
      counter = 0
    },
  }
}

// ── Retry Policy ──────────────────────────────────────────────────────

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterFactor: 0.3,
}

export function createRetryPolicy(config: Partial<RetryConfig> = {}): RetryPolicy {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config }

  return {
    shouldRetry(error, attempt) {
      // Never retry non-retryable errors
      if (!error.retryable) {
        return { retry: false }
      }

      // Bound on attempts
      if (attempt >= cfg.maxAttempts) {
        return { retry: false }
      }

      // Exponential backoff: baseDelay * 2^(attempt-1)
      const exponentialDelay = cfg.baseDelayMs * Math.pow(2, attempt - 1)
      const cappedDelay = Math.min(exponentialDelay, cfg.maxDelayMs)

      // Jitter: ±jitterFactor of the delay
      const jitterRange = cappedDelay * cfg.jitterFactor
      const jitter = (Math.random() * 2 - 1) * jitterRange
      const delayMs = Math.max(0, Math.round(cappedDelay + jitter))

      return { retry: true, delayMs }
    },
  }
}

/** Deterministic retry policy for testing (no jitter randomness). */
export function createFakeRetryPolicy(config: Partial<RetryConfig> = {}): RetryPolicy {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config }

  return {
    shouldRetry(error, attempt) {
      if (!error.retryable) {
        return { retry: false }
      }
      if (attempt >= cfg.maxAttempts) {
        return { retry: false }
      }
      const delay = cfg.baseDelayMs * Math.pow(2, attempt - 1)
      const cappedDelay = Math.min(delay, cfg.maxDelayMs)
      return { retry: true, delayMs: cappedDelay }
    },
  }
}
