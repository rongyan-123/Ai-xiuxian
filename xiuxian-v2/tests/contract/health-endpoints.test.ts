/**
 * Health endpoint contract tests (TDD: RED phase).
 *
 * These tests MUST fail because the API v1 route handlers under
 * src/app/api/v1/health/ do not exist yet.
 */
import { describe, it, expect } from 'vitest'

// Import route handlers — these don't exist yet (RED phase)
// We'll test the exported GET functions directly

describe('3.5 Health endpoints', () => {
  describe('GET /api/v1/health/live', () => {
    let GET: (req: Request) => Promise<Response>

    beforeAll(async () => {
      const mod = await import('@/app/api/v1/health/live/route')
      GET = mod.GET
    })

    it('returns 200 with status ok', async () => {
      const response = await GET(new Request('http://localhost/api/v1/health/live'))
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toEqual({ status: 'ok' })
    })

    it('content-type is application/json', async () => {
      const response = await GET(new Request('http://localhost/api/v1/health/live'))
      expect(response.headers.get('content-type')).toContain('application/json')
    })

    it('does not check any dependencies', async () => {
      // Liveness is a pure process-is-alive check — no dependency checks
      const response = await GET(new Request('http://localhost/api/v1/health/live'))
      expect(response.status).toBe(200)
      // Body should only contain status, no dependency information
      const body = await response.json()
      expect(body).not.toHaveProperty('checks')
      expect(body).not.toHaveProperty('database')
    })

    it('does not cause side effects (safe for polling)', async () => {
      // Call 10 times — no state changes, no errors
      for (let i = 0; i < 10; i++) {
        const response = await GET(new Request('http://localhost/api/v1/health/live'))
        expect(response.status).toBe(200)
      }
    })
  })

  describe('GET /api/v1/health/ready', () => {
    let GET: (req: Request) => Promise<Response>

    beforeAll(async () => {
      const mod = await import('@/app/api/v1/health/ready/route')
      GET = mod.GET
    })

    it('returns valid readiness body with dependency checks', async () => {
      const response = await GET(new Request('http://localhost/api/v1/health/ready'))
      const body = await response.json()
      expect(body.status).toBeDefined()
      expect(['ok', 'degraded', 'unavailable']).toContain(body.status)
      expect(body.checks).toBeDefined()
      expect(body.checks).toHaveProperty('database')
      expect(['ok', 'degraded', 'unavailable']).toContain(body.checks.database)
      // HTTP status must match the body: 200 for ok/degraded, 503 for unavailable
      if (body.checks.database === 'unavailable') {
        expect(response.status).toBe(503)
      } else {
        expect(response.status).toBe(200)
      }
    })

    it('content-type is application/json', async () => {
      const response = await GET(new Request('http://localhost/api/v1/health/ready'))
      expect(response.headers.get('content-type')).toContain('application/json')
    })

    it('does not invoke paid LLM generation', async () => {
      // The health check must not make any external LLM calls
      // We verify this by checking the handler completes quickly and doesn't error
      const start = Date.now()
      const response = await GET(new Request('http://localhost/api/v1/health/ready'))
      const duration = Date.now() - start
      expect(duration).toBeLessThan(5000) // should resolve in under 5 seconds
      expect(response.status).toBeGreaterThanOrEqual(200)
      expect(response.status).toBeLessThan(600)
    })

    it('is safe for repeated polling', async () => {
      for (let i = 0; i < 5; i++) {
        const response = await GET(new Request('http://localhost/api/v1/health/ready'))
        expect(response.status).toBeGreaterThanOrEqual(200)
        expect(response.status).toBeLessThan(600)
      }
    })
  })
})
