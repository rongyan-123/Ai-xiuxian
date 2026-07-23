/**
 * Request context unit tests (TDD: RED phase).
 *
 * These tests MUST fail because the production modules under
 * @/server/observability/ do not exist yet.
 */
import { describe, it, expect } from 'vitest'

// Import from modules that don't exist yet — this is the RED phase
import {
  createRequestContext,
  type RequestContext,
  type RequestContextInput,
} from '@/server/observability/request-context'

describe('3.1 Request context', () => {
  describe('createRequestContext', () => {
    it('creates an immutable context with all required fields', () => {
      const input: RequestContextInput = {
        requestId: 'req-001',
        runId: 'run-001',
        deadline: Date.now() + 60_000,
        abortSignal: new AbortController().signal,
        actorId: 'player-1',
        actorName: '张三',
      }

      const ctx = createRequestContext(input)

      expect(ctx.requestId).toBe('req-001')
      expect(ctx.runId).toBe('run-001')
      expect(ctx.deadline).toBe(input.deadline)
      expect(ctx.abortSignal).toBe(input.abortSignal)
      expect(ctx.actorId).toBe('player-1')
      expect(ctx.actorName).toBe('张三')
      expect(ctx.createdAt).toBeLessThanOrEqual(Date.now())
    })

    it('generates unique request IDs when not provided', () => {
      const ctx1 = createRequestContext({ deadline: Date.now() + 60_000 })
      const ctx2 = createRequestContext({ deadline: Date.now() + 60_000 })
      expect(ctx1.requestId).toBeTruthy()
      expect(ctx2.requestId).toBeTruthy()
      expect(ctx1.requestId).not.toBe(ctx2.requestId)
    })

    it('generates unique run IDs per context', () => {
      const ctx = createRequestContext({ deadline: Date.now() + 60_000 })
      expect(ctx.runId).toBeTruthy()
      expect(ctx.runId).not.toBe(ctx.requestId)
    })

    it('creates an AbortSignal when none is provided', () => {
      const ctx = createRequestContext({ deadline: Date.now() + 60_000 })
      expect(ctx.abortSignal).toBeInstanceOf(AbortSignal)
    })

    it('records creation timestamp', () => {
      const before = Date.now()
      const ctx = createRequestContext({ deadline: Date.now() + 60_000 })
      const after = Date.now()
      expect(ctx.createdAt).toBeGreaterThanOrEqual(before)
      expect(ctx.createdAt).toBeLessThanOrEqual(after)
    })

    it('stores optional provider configuration', () => {
      const ctx = createRequestContext({
        deadline: Date.now() + 60_000,
        providerConfig: { model: 'gpt-4', temperature: 0.7 },
      })
      expect(ctx.providerConfig).toEqual({ model: 'gpt-4', temperature: 0.7 })
    })

    it('stores optional metadata', () => {
      const ctx = createRequestContext({
        deadline: Date.now() + 60_000,
        metadata: { source: 'web', clientVersion: '1.0' },
      })
      expect(ctx.metadata).toEqual({ source: 'web', clientVersion: '1.0' })
    })
  })

  describe('RequestContext immutability', () => {
    it('cannot be mutated after creation (TypeScript compilation check)', () => {
      const ctx = createRequestContext({ deadline: Date.now() + 60_000 })
      // Verify the object is frozen at runtime
      expect(Object.isFrozen(ctx)).toBe(true)
    })

    it('nested objects in context are also frozen', () => {
      const ctx = createRequestContext({
        deadline: Date.now() + 60_000,
        metadata: { source: 'web' },
      })
      expect(Object.isFrozen(ctx.metadata)).toBe(true)
    })
  })

  describe('context signal propagation', () => {
    it('aborted signal reflects in the context', () => {
      const controller = new AbortController()
      const ctx = createRequestContext({
        deadline: Date.now() + 60_000,
        abortSignal: controller.signal,
      })
      expect(ctx.abortSignal.aborted).toBe(false)
      controller.abort()
      expect(ctx.abortSignal.aborted).toBe(true)
    })

    it('isExpired returns true when deadline has passed', async () => {
      const ctx = createRequestContext({
        deadline: Date.now() + 10, // 10ms in the future
      })
      expect(ctx.isExpired()).toBe(false)
      await new Promise((r) => setTimeout(r, 20))
      expect(ctx.isExpired()).toBe(true)
    })
  })

  describe('concurrent context isolation', () => {
    it('each context has independent request and run IDs', () => {
      const ctx1 = createRequestContext({ deadline: Date.now() + 60_000 })
      const ctx2 = createRequestContext({ deadline: Date.now() + 60_000 })

      expect(ctx1.requestId).not.toBe(ctx2.requestId)
      expect(ctx1.runId).not.toBe(ctx2.runId)
    })

    it('each context has independent abort signals', () => {
      const ctrl1 = new AbortController()
      const ctrl2 = new AbortController()
      const ctx1 = createRequestContext({
        deadline: Date.now() + 60_000,
        abortSignal: ctrl1.signal,
      })
      const ctx2 = createRequestContext({
        deadline: Date.now() + 60_000,
        abortSignal: ctrl2.signal,
      })

      ctrl1.abort()
      expect(ctx1.abortSignal.aborted).toBe(true)
      expect(ctx2.abortSignal.aborted).toBe(false)
    })

    it('each context has independent provider configuration', () => {
      const ctx1 = createRequestContext({
        deadline: Date.now() + 60_000,
        providerConfig: { model: 'gpt-4' },
      })
      const ctx2 = createRequestContext({
        deadline: Date.now() + 60_000,
        providerConfig: { model: 'claude-3' },
      })
      expect(ctx1.providerConfig).toEqual({ model: 'gpt-4' })
      expect(ctx2.providerConfig).toEqual({ model: 'claude-3' })
    })
  })
})
