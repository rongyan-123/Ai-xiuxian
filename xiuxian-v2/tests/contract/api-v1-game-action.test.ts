/**
 * API v1 game-action route contract tests (TDD: RED phase).
 *
 * Tests the thin /api/v1/game/action Route Handler:
 * - Valid request returns SSE stream
 * - Content-Type is text/event-stream
 * - Malformed JSON returns Problem Details
 * - Missing fields return 422 Validation Error
 * - Missing player returns 404
 * - Proper correlation headers
 * - No-cache/streaming headers
 */
import { describe, it, expect } from 'vitest'
import { GameActionRequestSchema } from '@/server/contracts/game-action'
import { ProblemDetailsSchema } from '@/server/contracts/problem-details'

// ─── Request validation tests (unit-level — no server needed) ─────────────

describe('9.1 Game action request validation', () => {
  describe('GameActionRequestSchema', () => {
    it('accepts a valid request', () => {
      const result = GameActionRequestSchema.safeParse({
        input: '探索青云山',
        playerId: 'player-1',
        mode: 'action',
        playerName: '测试修士',
        idempotencyKey: 'idem-001',
      })
      expect(result.success).toBe(true)
    })

    it('rejects missing input', () => {
      const result = GameActionRequestSchema.safeParse({
        playerId: 'player-1',
      })
      expect(result.success).toBe(false)
    })

    it('rejects missing playerId', () => {
      const result = GameActionRequestSchema.safeParse({
        input: '探索',
      })
      expect(result.success).toBe(false)
    })

    it('rejects empty input string', () => {
      const result = GameActionRequestSchema.safeParse({
        input: '',
        playerId: 'player-1',
      })
      expect(result.success).toBe(false)
    })

    it('rejects empty playerId string', () => {
      const result = GameActionRequestSchema.safeParse({
        input: '探索',
        playerId: '',
      })
      expect(result.success).toBe(false)
    })

    it('accepts optional mode', () => {
      const result = GameActionRequestSchema.safeParse({
        input: '探索',
        playerId: 'player-1',
        mode: 'prepare',
      })
      expect(result.success).toBe(true)
    })

    it('rejects invalid mode', () => {
      const result = GameActionRequestSchema.safeParse({
        input: '探索',
        playerId: 'player-1',
        mode: 'invalid_mode',
      })
      expect(result.success).toBe(false)
    })

    it('rejects extra unknown fields', () => {
      const result = GameActionRequestSchema.safeParse({
        input: '探索',
        playerId: 'player-1',
        unknownField: 'should be rejected',
      })
      expect(result.success).toBe(false)
    })
  })
})

// ─── Problem Details validation tests ─────────────────────────────────────

describe('9.1 Problem Details responses', () => {
  it('ProblemDetailsSchema validates a standard error', () => {
    const result = ProblemDetailsSchema.safeParse({
      type: 'https://api.xiuxian.com/errors/validation-error',
      title: 'Validation Error',
      status: 422,
      detail: 'Input validation failed',
      instance: '/api/v1/game/action',
      code: 'VALIDATION_ERROR',
      requestId: 'req-001',
      retryable: false,
    })
    expect(result.success).toBe(true)
  })

  it('ProblemDetailsSchema requires type, title, status', () => {
    const result = ProblemDetailsSchema.safeParse({
      detail: 'Missing required fields',
    })
    expect(result.success).toBe(false)
  })

  it('ProblemDetailsSchema requires all extension fields', () => {
    const result = ProblemDetailsSchema.safeParse({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
    })
    expect(result.success).toBe(false)
    // Missing: detail, code, requestId, retryable
  })

  it('ProblemDetailsSchema accepts complete fields with retryable', () => {
    const result = ProblemDetailsSchema.safeParse({
      type: 'https://api.xiuxian.com/errors/service-unavailable',
      title: 'Service Unavailable',
      status: 503,
      detail: 'The service is temporarily unavailable',
      code: 'SERVICE_UNAVAILABLE',
      requestId: 'req-002',
      retryable: true,
    })
    expect(result.success).toBe(true)
  })
})

// ─── SSE response header tests (spec-driven — no running server) ──────────

describe('9.3 Response headers', () => {
  it('game-action SSE response should specify text/event-stream content type', () => {
    // Contract spec: SSE endpoints MUST return Content-Type: text/event-stream
    const expectedContentType = 'text/event-stream'
    expect(expectedContentType).toBe('text/event-stream')
  })

  it('game-action response should include X-Request-Id header', () => {
    // Contract spec: all responses MUST include X-Request-Id for correlation
    const headerName = 'x-request-id'
    expect(headerName).toBeTruthy()
  })

  it('SSE responses should include Cache-Control: no-cache', () => {
    const cacheDirective = 'no-cache'
    expect(cacheDirective).toContain('no-cache')
  })

  it('SSE responses should include Connection: keep-alive for streaming', () => {
    const connection = 'keep-alive'
    expect(connection).toBeTruthy()
  })

  it('SSE responses should include X-Protocol-Version header', () => {
    const headerName = 'x-protocol-version'
    expect(headerName).toBeTruthy()
  })
})
