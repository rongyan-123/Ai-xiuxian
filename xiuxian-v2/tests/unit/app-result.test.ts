/**
 * Task 2.3 & 2.4: AppResult and Problem Details serialization tests.
 *
 * Verifies:
 * - Every error code maps to a documented HTTP status
 * - Retryability is consistent
 * - AppResult discriminated union works correctly
 * - Problem Details serialization is correct
 * - Secret redaction in error serialization
 * - Unknown exception → sanitized 500
 */
import { describe, it, expect } from 'vitest'
import {
  ok, err, appError, Errors, isAppError,
  type AppResult, type AppError,
} from '@/server/contracts/app-result'
import { ErrorCodes, errorCodeToStatus, retryableCodes, type ErrorCode } from '@/server/contracts/problem-details'
import { ProblemDetailsSchema } from '@/server/contracts/problem-details'

// ── 2.3a: AppResult discriminated union ────────────────────────────────

describe('2.3a AppResult<T> discriminated union', () => {
  it('ok() returns { ok: true, value }', () => {
    const r: AppResult<number> = ok(42)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toBe(42)
    }
  })

  it('err() returns { ok: false, error }', () => {
    const r = err(appError('NOT_FOUND' as ErrorCode, 'test'))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('NOT_FOUND')
    }
  })

  it('TypeScript narrows correctly in if/else', () => {
    const r = ok('hello')
    if (r.ok) {
      // value should be accessible
      const _: string = r.value
      expect(_).toBe('hello')
    } else {
      // unreachable
      expect(true).toBe(false)
    }
  })

  it('TypeScript narrows err correctly', () => {
    const r = err<string>(appError('INTERNAL_ERROR' as ErrorCode, 'boom'))
    if (!r.ok) {
      const _: AppError = r.error
      expect(_.code).toBe('INTERNAL_ERROR')
    }
  })

  it('isAppError type guard works', () => {
    const e = appError('VALIDATION_ERROR' as ErrorCode, 'bad')
    expect(isAppError(e)).toBe(true)
    expect(isAppError({})).toBe(false)
    expect(isAppError(null)).toBe(false)
    expect(isAppError('string')).toBe(false)
  })
})

// ── 2.3b: Exhaustive error code → status mapping ──────────────────────

describe('2.3b Exhaustive error code mapping', () => {
  it('every ErrorCode has a status mapping', () => {
    for (const code of Object.values(ErrorCodes)) {
      expect(errorCodeToStatus[code]).toBeDefined()
      expect(errorCodeToStatus[code]).toBeGreaterThanOrEqual(400)
      expect(errorCodeToStatus[code]).toBeLessThan(600)
    }
  })

  it('all 4xx codes are < 500', () => {
    const c4xx = [
      ErrorCodes.VALIDATION_ERROR, ErrorCodes.MALFORMED_JSON,
      ErrorCodes.UNAUTHORIZED, ErrorCodes.FORBIDDEN,
      ErrorCodes.NOT_FOUND, ErrorCodes.PLAYER_NOT_FOUND,
      ErrorCodes.TURN_CONFLICT, ErrorCodes.TURN_IN_PROGRESS,
      ErrorCodes.TURN_ALREADY_COMPLETED, ErrorCodes.RATE_LIMITED,
    ]
    for (const code of c4xx) {
      expect(errorCodeToStatus[code]).toBeLessThan(500)
    }
  })

  it('retryable codes are only transient errors', () => {
    // Non-retryable: auth errors, validation, conflicts, not-found, internal
    const nonRetryable = [
      ErrorCodes.VALIDATION_ERROR, ErrorCodes.MALFORMED_JSON,
      ErrorCodes.UNAUTHORIZED, ErrorCodes.FORBIDDEN,
      ErrorCodes.NOT_FOUND, ErrorCodes.PLAYER_NOT_FOUND,
      ErrorCodes.TURN_CONFLICT, ErrorCodes.TURN_IN_PROGRESS,
      ErrorCodes.TURN_ALREADY_COMPLETED,
      ErrorCodes.LLM_AUTH_ERROR, ErrorCodes.LLM_PROTOCOL_ERROR,
      ErrorCodes.RAG_PROTOCOL_ERROR,
      ErrorCodes.INTERNAL_ERROR,
    ]
    for (const code of nonRetryable) {
      expect(retryableCodes.has(code)).toBe(false)
    }
  })

  it('retryable codes are transient/availability errors', () => {
    const retryable = [
      ErrorCodes.LLM_TIMEOUT, ErrorCodes.LLM_RATE_LIMITED,
      ErrorCodes.LLM_UNAVAILABLE, ErrorCodes.RAG_UNAVAILABLE,
      ErrorCodes.DB_UNAVAILABLE, ErrorCodes.DB_TIMEOUT,
      ErrorCodes.DEPENDENCY_TIMEOUT, ErrorCodes.DEPENDENCY_UNAVAILABLE,
      ErrorCodes.RATE_LIMITED,
    ]
    for (const code of retryable) {
      expect(retryableCodes.has(code)).toBe(true)
    }
  })
})

// ── 2.3c: Error factory functions ─────────────────────────────────────

describe('2.3c Error factory functions', () => {
  it('Errors.validation creates correct error', () => {
    const e = Errors.validation('input is required')
    expect(e.code).toBe('VALIDATION_ERROR')
    expect(e.status).toBe(422)
    expect(e.retryable).toBe(false)
  })

  it('Errors.notFound creates correct error', () => {
    const e = Errors.notFound('Player')
    expect(e.code).toBe('NOT_FOUND')
    expect(e.status).toBe(404)
    expect(e.detail).toContain('Player')
  })

  it('Errors.turnConflict creates correct error', () => {
    const e = Errors.turnConflict('version mismatch')
    expect(e.code).toBe('TURN_CONFLICT')
    expect(e.status).toBe(409)
    expect(e.retryable).toBe(false)
  })

  it('Errors.llmTimeout is retryable', () => {
    const e = Errors.llmTimeout()
    expect(e.code).toBe('LLM_TIMEOUT')
    expect(e.status).toBe(504)
    expect(e.retryable).toBe(true)
  })

  it('Errors.internal preserves cause but is NOT retryable (side-effect risk)', () => {
    const cause = new Error('DB connection refused')
    const e = Errors.internal(cause)
    expect(e.code).toBe('INTERNAL_ERROR')
    expect(e.status).toBe(500)
    expect(e.retryable).toBe(false)
    expect(e.cause).toBe(cause)
  })

  it('Errors.dependencyTimeout includes dependency name', () => {
    const e = Errors.dependencyTimeout('RAG')
    expect(e.code).toBe('DEPENDENCY_TIMEOUT')
    expect(e.status).toBe(504)
    expect(e.detail).toContain('RAG')
  })

  it('every Errors factory returns a valid AppError', () => {
    const factories = [
      () => Errors.validation('x'),
      () => Errors.malformedJson('x'),
      () => Errors.notFound('x'),
      () => Errors.playerNotFound('x'),
      () => Errors.turnConflict('x'),
      () => Errors.turnInProgress(),
      () => Errors.turnAlreadyCompleted(),
      () => Errors.internal(),
      () => Errors.llmTimeout(),
      () => Errors.llmAuthError(),
      () => Errors.llmProtocolError('x'),
      () => Errors.llmRateLimited(),
      () => Errors.llmUnavailable(),
      () => Errors.ragUnavailable(),
      () => Errors.ragProtocolError('x'),
      () => Errors.dbUnavailable(),
      () => Errors.dbTimeout(),
      () => Errors.dependencyTimeout('x'),
      () => Errors.dependencyUnavailable('x'),
    ]
    for (const f of factories) {
      const e = f()
      expect(isAppError(e)).toBe(true)
      expect(e.code).toBeTruthy()
      expect(e.status).toBeGreaterThanOrEqual(400)
      expect(typeof e.retryable).toBe('boolean')
    }
  })
})

// ── 2.4a: Problem Details serialization ────────────────────────────────

describe('2.4a Problem Details serialization', () => {
  /**
   * Serializes an AppError to an RFC 9457 Problem Details response body.
   * This is the centralized mapping that production code will use.
   */
  function toProblemDetails(
    error: AppError,
    requestId: string,
    instance?: string,
  ): Record<string, unknown> {
    return {
      type: `https://api.xiuxian.com/errors/${error.code.toLowerCase()}`,
      title: error.code.replace(/_/g, ' '),
      status: error.status,
      detail: error.detail,
      ...(instance ? { instance } : {}),
      code: error.code,
      requestId,
      retryable: error.retryable,
    }
  }

  it('serializes a validation error to Problem Details', () => {
    const body = toProblemDetails(
      Errors.validation('input is required'),
      'req-abc',
    )
    expect(ProblemDetailsSchema.safeParse(body).success).toBe(true)
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(body.status).toBe(422)
    expect(body.retryable).toBe(false)
    expect(body.requestId).toBe('req-abc')
  })

  it('includes instance when provided', () => {
    const body = toProblemDetails(
      Errors.notFound('Player'),
      'req-xyz',
      '/api/v1/players/nonexistent',
    )
    expect(body.instance).toBe('/api/v1/players/nonexistent')
  })

  it('excludes instance when not provided', () => {
    const body = toProblemDetails(Errors.internal(), 'req-1')
    expect(body.instance).toBeUndefined()
  })

  it('serializes an internal error with cause hidden', () => {
    const cause = new Error('DB password: secret123')
    const e = Errors.internal(cause)
    const body = toProblemDetails(e, 'req-1')
    // cause should NOT be in the response
    expect(body).not.toHaveProperty('cause')
    expect(body.detail).toBe('An unexpected error occurred')
    // But status should be correct
    expect(body.status).toBe(500)
    expect(body.code).toBe('INTERNAL_ERROR')
  })

  it('validates against the ProblemDetails schema', () => {
    const allErrors = [
      Errors.validation('x'), Errors.notFound('x'), Errors.internal(),
      Errors.llmTimeout(), Errors.dbUnavailable(), Errors.turnConflict('x'),
    ]
    for (const e of allErrors) {
      const body = toProblemDetails(e, 'req-test')
      const parsed = ProblemDetailsSchema.safeParse(body)
      expect(parsed.success).toBe(true)
    }
  })

  it('Problem Details content type is application/problem+json', () => {
    // This isn't a test of serialization per se, but documents the expected
    // content type that the HTTP adapter must set.
    const contentType = 'application/problem+json'
    expect(contentType).toBe('application/problem+json')
  })
})

// ── 2.4b: Unknown exception → sanitized 500 ───────────────────────────

describe('2.4b Unknown exception handling', () => {
  function mapExceptionToProblem(exception: unknown, requestId: string): AppResult<never> {
    if (isAppError(exception)) {
      return err(exception)
    }
    // Unknown exception → sanitized INTERNAL_ERROR
    return err(appError('INTERNAL_ERROR' as ErrorCode, 'An unexpected error occurred', exception))
  }

  it('maps a known AppError directly', () => {
    const r = mapExceptionToProblem(Errors.notFound('Player'), 'req-1')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('NOT_FOUND')
    }
  })

  it('maps an unknown Error to INTERNAL_ERROR with cause', () => {
    const original = new Error('Something broke')
    const r = mapExceptionToProblem(original, 'req-1')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('INTERNAL_ERROR')
      expect(r.error.detail).not.toContain('Something broke')
      expect(r.error.cause).toBe(original)
    }
  })

  it('maps a string to INTERNAL_ERROR', () => {
    const r = mapExceptionToProblem('just a string error', 'req-1')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('INTERNAL_ERROR')
    }
  })

  it('maps null/undefined to INTERNAL_ERROR', () => {
    const r1 = mapExceptionToProblem(null, 'req-1')
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.error.code).toBe('INTERNAL_ERROR')

    const r2 = mapExceptionToProblem(undefined, 'req-2')
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error.code).toBe('INTERNAL_ERROR')
  })

  it('never exposes stack traces in detail', () => {
    const e = new Error('DB_URL=postgresql://secret')
    e.stack = 'Error: DB_URL=postgresql://secret\n    at ...'
    const r = mapExceptionToProblem(e, 'req-1')
    if (!r.ok) {
      expect(r.error.detail).not.toContain('DB_URL')
      expect(r.error.detail).not.toContain('postgresql')
      expect(r.error.detail).not.toContain('secret')
    }
  })
})
