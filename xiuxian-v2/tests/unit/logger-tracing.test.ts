/**
 * Structured logging and tracing unit tests (TDD: RED phase).
 *
 * These tests MUST fail because @/server/observability/logger
 * and @/server/observability/tracing do not exist yet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { createLogger, type Logger, type LogContext } from '@/server/observability/logger'
import { createSpan, type Span } from '@/server/observability/tracing'
import { createRequestContext } from '@/server/observability/request-context'

describe('3.3 Structured logger', () => {
  let logger: Logger

  beforeEach(() => {
    logger = createLogger({ service: 'xiuxian-api' })
  })

  describe('createLogger', () => {
    it('creates a logger with service name', () => {
      expect(logger).toBeDefined()
      expect(logger.serviceName).toBe('xiuxian-api')
    })

    it('accepts log level configuration', () => {
      const debugLogger = createLogger({ service: 'test', level: 'debug' })
      expect(debugLogger.level).toBe('debug')
    })
  })

  describe('logging levels', () => {
    it('info() emits structured output', () => {
      const spy = vi.fn()
      const l = createLogger({ service: 'test', write: spy })
      l.info('test message', { extraField: 'value' })
      expect(spy).toHaveBeenCalledTimes(1)
      const entry = spy.mock.calls[0][0]
      expect(entry.level).toBe('info')
      expect(entry.message).toBe('test message')
      expect(entry.extraField).toBe('value')
      expect(entry.service).toBe('test')
      expect(entry.timestamp).toBeTruthy()
    })

    it('warn() emits with level warn', () => {
      const spy = vi.fn()
      const l = createLogger({ service: 'test', write: spy })
      l.warn('warning msg')
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][0].level).toBe('warn')
    })

    it('error() emits with level error', () => {
      const spy = vi.fn()
      const l = createLogger({ service: 'test', write: spy })
      l.error('error msg', { errorType: 'TEST_ERROR' })
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][0].level).toBe('error')
    })

    it('debug() emits with level debug', () => {
      const spy = vi.fn()
      const l = createLogger({ service: 'test', level: 'debug', write: spy })
      l.debug('debug msg')
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][0].level).toBe('debug')
    })

    it('does not emit debug when level is info', () => {
      const spy = vi.fn()
      const l = createLogger({ service: 'test', level: 'info', write: spy })
      l.debug('should not appear')
      expect(spy).not.toHaveBeenCalled()
    })

    it('includes request context fields when provided', () => {
      const spy = vi.fn()
      const l = createLogger({ service: 'test', write: spy })
      const ctx = createRequestContext({ deadline: Date.now() + 60_000 })
      l.info('with context', { requestContext: ctx })
      const entry = spy.mock.calls[0][0]
      expect(entry.requestId).toBe(ctx.requestId)
      expect(entry.runId).toBe(ctx.runId)
    })

    it('redacts sensitive fields in log entries', () => {
      const spy = vi.fn()
      const l = createLogger({ service: 'test', write: spy })
      l.info('request sent', {
        request: {
          headers: { authorization: 'Bearer secret-token' },
          body: { apiKey: 'sk-abc' },
        },
      })
      const entry = spy.mock.calls[0][0]
      const req = entry.request as Record<string, unknown>
      expect(req.headers).toEqual({ authorization: '[REDACTED]' })
      expect(req.body).toEqual({ apiKey: '[REDACTED]' })
    })

    it('includes error causes recursively', () => {
      const spy = vi.fn()
      const l = createLogger({ service: 'test', write: spy })
      const rootCause = new Error('root')
      const midCause = new Error('middle')
      const topError = new Error('top')
      midCause.cause = rootCause
      topError.cause = midCause

      l.error('chain error', { err: topError })
      const entry = spy.mock.calls[0][0]
      expect(entry.error?.message).toBe('top')
      expect(entry.error?.cause?.message).toBe('middle')
      expect(entry.error?.cause?.cause?.message).toBe('root')
    })
  })
})

describe('3.4 Tracing spans', () => {
  describe('createSpan', () => {
    it('creates an HTTP server span', () => {
      const span = createSpan('http.server', {
        name: 'POST /api/v1/game/action',
        attributes: {
          'http.method': 'POST',
          'http.route': '/api/v1/game/action',
        },
      })
      expect(span).toBeDefined()
      expect(span.name).toBe('POST /api/v1/game/action')
      expect(span.kind).toBe('http.server')
      expect(span.status).toBe('ok')
    })

    it('creates an LLM call span', () => {
      const span = createSpan('llm', {
        name: 'chat.completion',
        attributes: {
          'llm.model': 'gpt-4',
          'llm.provider': 'openai',
        },
      })
      expect(span.kind).toBe('llm')
      expect(span.attributes['llm.model']).toBe('gpt-4')
    })

    it('creates a database span', () => {
      const span = createSpan('database', {
        name: 'prisma.query',
        attributes: {
          'db.system': 'postgresql',
          'db.operation': 'SELECT',
          'db.table': 'Player',
        },
      })
      expect(span.kind).toBe('database')
    })

    it('assigns unique span IDs', () => {
      const s1 = createSpan('test', { name: 'op1' })
      const s2 = createSpan('test', { name: 'op2' })
      expect(s1.id).toBeTruthy()
      expect(s2.id).toBeTruthy()
      expect(s1.id).not.toBe(s2.id)
    })

    it('sets status to error with error type', () => {
      const span = createSpan('http.server', { name: 'GET /api' })
      span.setError('TIMEOUT', 'Request timed out after 30s')
      expect(span.status).toBe('error')
      expect(span.errorType).toBe('TIMEOUT')
      expect(span.errorMessage).toBe('Request timed out after 30s')
    })

    it('records attempt count', () => {
      const span = createSpan('llm', { name: 'chat.completion' })
      span.incrementAttempt()
      span.incrementAttempt()
      span.incrementAttempt()
      expect(span.attemptCount).toBe(4)
    })

    it('records duration on end', async () => {
      const span = createSpan('test', { name: 'timed-op' })
      await new Promise((r) => setTimeout(r, 10))
      span.end()
      expect(span.durationMs).toBeGreaterThanOrEqual(8) // allow slight timing variance
      expect(span.durationMs).toBeLessThan(500)
    })

    it('strips sensitive content from span attributes', () => {
      const span = createSpan('llm', {
        name: 'chat.completion',
        attributes: {
          'llm.request_type': 'chat_completion',
          'llm.api_key': 'sk-secret',
          'http.authorization': 'Bearer token',
        },
      })
      // Sensitive attributes should be redacted
      expect(span.attributes['llm.api_key']).toBe('[REDACTED]')
      expect(span.attributes['http.authorization']).toBe('[REDACTED]')
      // Non-sensitive attributes should pass through
      expect(span.attributes['llm.request_type']).toBe('chat_completion')
    })

    it('supports parent-child span relationships', () => {
      const parent = createSpan('http.server', { name: 'request' })
      const child = createSpan('database', {
        name: 'query',
        parentSpanId: parent.id,
        traceId: parent.traceId,
      })
      expect(child.parentSpanId).toBe(parent.id)
      expect(child.traceId).toBe(parent.traceId)
    })
  })
})
