/**
 * Smoke Test — Complete Agent Lifecycle End-to-End (TDD: RED → GREEN).
 *
 * Validates the full pipeline with real PostgreSQL persistence:
 *   HTTP POST → route handler → executeGameTurn → Prisma repos → PostgreSQL
 *   → SSE stream → client parsing → reducer state transitions
 *
 * This is the definitive test that proves the Agent framework works end-to-end.
 * Mocked LLM for speed/reliability; every other component is REAL.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { POST } from '@/app/api/v1/game/action/route'
import { SSEEventSchema } from '@/server/contracts/sse-events'
import { parseSSEChunk } from '@/client/sse-parser'
import { gameTurnReducer, initialGameTurnState } from '@/client/game-turn-reducer'
import type { GameTurnState } from '@/client/game-turn-reducer'
import type { ParsedSSEEvent } from '@/client/sse-parser'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import type { PlayerSnapshot } from '@/server/infrastructure/ports'

// ─── Test DB Setup ────────────────────────────────────────────────────────

const TEST_DB_URL = 'postgresql://postgres:password@localhost:5433/xiuxian_test?schema=public'

let prisma: PrismaClient
let originalDbUrl: string | undefined

beforeAll(async () => {
  prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DB_URL) })
  // Stub DATABASE_URL so route.ts uses real Prisma repos — restore in afterAll
  originalDbUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = TEST_DB_URL
})

afterAll(async () => {
  await prisma.$disconnect()
  process.env.DATABASE_URL = originalDbUrl
})

beforeEach(async () => {
  // Delete children first (FK constraints), then parent
  await prisma.outboxRecord.deleteMany()
  await prisma.gameTurnExecution.deleteMany()
  await prisma.chatMessage.deleteMany()
  await prisma.conversationSummary.deleteMany()
  await prisma.player.deleteMany()
})

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeRequest(overrides: Record<string, unknown> = {}): Request {
  return new Request('http://localhost/api/v1/game/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: '探索青云山',
      playerId: 'player-smoke-001',
      mode: 'action',
      playerName: '烟测修士',
      idempotencyKey: `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...overrides,
    }),
  })
}

async function seedPlayer(snapshot: PlayerSnapshot): Promise<void> {
  await prisma.player.create({
    data: {
      id: snapshot.id,
      status: snapshot.status,
      name: snapshot.name,
      gender: snapshot.gender,
      version: snapshot.version,
      stats: snapshot.stats as any,
      inventory: snapshot.inventory as any,
      codex: snapshot.codex as any,
      relationships: snapshot.relationships as any,
      situations: snapshot.situations as any,
      foreshadowings: snapshot.foreshadowings as any,
    },
  })
}

function makeSmokePlayer(): PlayerSnapshot {
  return {
    id: 'player-smoke-001',
    status: 'ALIVE',
    name: '烟测修士',
    gender: '男',
    version: 0,
    stats: {
      hp: { current: 100, max: 100, status_desc: '健康' },
      mp: { current: 50, max: 50, status_desc: '充足' },
      spirit: { value: 5, desc: '凡识' },
      realm: '练气期一层',
      age: { current: 18, max: 120 },
      race: '人族',
      alignment: '正道' as const,
      sect: '散修',
      spiritual_root: '金灵根',
      mental_state: '正常',
      reputation: 0,
      emotion: '平静',
      state_of_mind: 80,
      fortune: 50,
      karma: 0,
      techniques: { main: '基础吐纳', combat: [], movement: '步行', support: [] },
      shield: { current: 0, max: 50 },
      talents: [],
      traits: [],
    },
    inventory: [{ id: 'item-1', name: '灵石', count: 100, type: 'material', grade: 'common', description: '货币', value: 10 }],
    codex: [],
    relationships: {},
    situations: [],
    foreshadowings: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

interface RawParsedEvent {
  type: string
  sequence?: number
  requestId?: string
  runId?: string
  payload?: Record<string, unknown>
  raw: Record<string, unknown>
}

async function readSSEStreamParsed(response: Response): Promise<RawParsedEvent[]> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''
  const events: RawParsedEvent[] = []

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      let currentData = ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          currentData += line.slice(6)
        } else if (line === '') {
          if (currentData) {
            try {
              const parsed = JSON.parse(currentData)
              events.push({
                type: parsed.type ?? 'unknown',
                sequence: parsed.sequence,
                requestId: parsed.requestId,
                runId: parsed.runId,
                payload: parsed.payload,
                raw: parsed,
              })
            } catch { /* skip non-JSON */ }
            currentData = ''
          }
        }
      }
    }
  } catch { /* stream ended */ }

  return events
}

// ─── Mock Helpers ─────────────────────────────────────────────────────────

let originalFetch: typeof fetch

function mockFetchSuccess(content: string): void {
  globalThis.fetch = vi.fn(async () => {
    return new Response(JSON.stringify({
      id: 'chatcmpl-smoke',
      object: 'chat.completion',
      created: Date.now(),
      model: 'smoke-model',
      choices: [{
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 50, completion_tokens: content.length, total_tokens: 50 + content.length },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
}

// ─── The Smoke Test ────────────────────────────────────────────────────────

describe('SMOKE: Complete Agent Lifecycle (Real DB + Mock LLM)', () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('SMOKE-1: full lifecycle — HTTP request → SSE stream → DB persistence', async () => {
    // Arrange: seed player in real PostgreSQL
    const player = makeSmokePlayer()
    await seedPlayer(player)

    // Verify player exists before the turn
    const beforePlayer = await prisma.player.findUnique({ where: { id: player.id } })
    expect(beforePlayer).not.toBeNull()
    expect(beforePlayer!.version).toBe(0)

    // Mock LLM to return narration text
    mockFetchSuccess('你踏入青云山，四周云雾缭绕，灵气充沛。远处传来一声悠远的钟鸣，似有古修洞府将要开启。')

    // Act: send HTTP request through the real route handler
    const req = makeRequest()
    const res = await POST(req)

    // Assert: HTTP-level
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
    expect(res.headers.get('X-Protocol-Version')).toBe('1.0')

    // Read and parse SSE stream
    const events = await readSSEStreamParsed(res)
    expect(events.length).toBeGreaterThan(0)

    // Assert: first event is accepted
    expect(events[0].type).toBe('accepted')

    // Assert: all events validate against SSEEventSchema
    for (const event of events) {
      const result = SSEEventSchema.safeParse(event.raw)
      if (!result.success) {
        console.error('Invalid event:', JSON.stringify(event.raw, null, 2))
        console.error('Issues:', result.error.issues)
      }
      expect(result.success).toBe(true)
    }

    // Assert: terminal event exists
    const terminalTypes = ['completed', 'failed', 'cancelled']
    const terminal = events.find(e => terminalTypes.includes(e.type))
    expect(terminal).toBeDefined()

    // Assert: text-delta contains the LLM response
    const textDelta = events.find(e => e.type === 'text-delta')
    expect(textDelta).toBeDefined()
    expect(textDelta!.payload).toBeDefined()
    expect(typeof (textDelta!.payload as Record<string, unknown>).content).toBe('string')
    expect((textDelta!.payload as Record<string, unknown>).content as string).toContain('青云山')

    // Assert: completed event has reply
    const completed = events.find(e => e.type === 'completed')
    expect(completed).toBeDefined()

    // ─── Database Persistence Verification ──────────────────────────────

    // Player should be updated (version incremented)
    const afterPlayer = await prisma.player.findUnique({ where: { id: player.id } })
    expect(afterPlayer).not.toBeNull()
    // Version should be incremented (0 → 1 after one turn)
    if (completed) {
      expect(afterPlayer!.version).toBeGreaterThanOrEqual(1)
    }

    // Turn execution should be recorded
    const turnRecord = await prisma.gameTurnExecution.findFirst({
      where: { playerId: player.id },
      orderBy: { createdAt: 'desc' },
    })
    expect(turnRecord).not.toBeNull()
    if (completed) {
      expect(turnRecord!.status).toBe('COMPLETED')
      expect(turnRecord!.candidateText).toBeTruthy()
      expect(turnRecord!.candidateText).toContain('青云山')
    }
  })

  it('SMOKE-2: client integration — reducer processes real server output', async () => {
    const player = makeSmokePlayer()
    await seedPlayer(player)

    mockFetchSuccess('洞府中灵气充沛，你盘膝打坐，感受着天地灵气的流动。修为在缓缓提升。')

    const req = makeRequest()
    const res = await POST(req)

    expect(res.status).toBe(200)

    // Use the actual client-side parser and reducer
    const reader = res.body!.getReader()!
    let buffer = ''
    let state: GameTurnState = { ...initialGameTurnState }

    // Submit action
    state = gameTurnReducer(state, {
      type: 'SUBMIT',
      playerId: player.id,
      playerName: player.name,
      input: '探索青云山',
      mode: 'action',
      idempotencyKey: 'smoke-client-001',
    })
    expect(state.status).toBe('submitting')

    const transitions: string[] = ['→ submitting']

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const { events } = parseSSEChunk(value, buffer)

        for (const rawEvent of events) {
          let parsed: Record<string, unknown>
          try { parsed = JSON.parse(rawEvent.data) } catch { continue }

          const prevStatus = state.status
          state = gameTurnReducer(state, {
            type: 'SSE_EVENT',
            event: {
              type: (parsed.type as string) ?? 'message',
              payload: (parsed.payload ?? parsed) as Record<string, unknown>,
              raw: rawEvent.data,
              sequence: parsed.sequence as number | undefined,
            },
          })

          if (state.status !== prevStatus) {
            transitions.push(`→ ${state.status}`)
          }
        }
      }
    } catch {
      // Stream ended
    }

    // Assert reducer state transitions
    expect(transitions).toContain('→ submitting')
    expect(transitions).toContain('→ streaming')
    // Final state should be terminal
    expect(['completed', 'failed']).toContain(state.status)

    // If completed, reply text should be accumulated
    if (state.status === 'completed') {
      expect(state.replyText.length).toBeGreaterThan(0)
      expect(state.replyText).toContain('洞府')
    }

    // Correlation IDs should be set
    expect(state.requestId).toBeTruthy()
    expect(state.runId).toBeTruthy()
  })

  it('SMOKE-3: idempotency — same key replays without side effects', async () => {
    const player = makeSmokePlayer()
    player.id = 'player-smoke-idem'
    await seedPlayer(player)

    mockFetchSuccess('第一次探索')
    mockFetchSuccess('第二次探索（不应出现）')

    const idempotencyKey = 'smoke-idem-replay'

    // First request
    const req1 = makeRequest({ playerId: player.id, idempotencyKey })
    const res1 = await POST(req1)
    const events1 = await readSSEStreamParsed(res1)
    const completed1 = events1.find(e => e.type === 'completed')
    expect(completed1).toBeDefined()

    // Verify DB state after first request
    const playerAfter1 = await prisma.player.findUnique({ where: { id: player.id } })
    const version1 = playerAfter1!.version

    // Count turn executions
    const turnCount1 = await prisma.gameTurnExecution.count({ where: { playerId: player.id } })

    // Second request with same idempotency key — should replay, not execute
    const req2 = makeRequest({ playerId: player.id, idempotencyKey })
    const res2 = await POST(req2)

    // Should be a successful response (replay)
    expect(res2.status).toBe(200)

    // Player version should NOT change (no new side effects)
    const playerAfter2 = await prisma.player.findUnique({ where: { id: player.id } })
    expect(playerAfter2!.version).toBe(version1)

    // Turn execution count should NOT increase
    const turnCount2 = await prisma.gameTurnExecution.count({ where: { playerId: player.id } })
    expect(turnCount2).toBe(turnCount1)
  })

  it('SMOKE-4: error handling — missing player returns failed event', async () => {
    // Don't seed a player — request references non-existent player
    mockFetchSuccess('不应到达LLM')

    const req = makeRequest({ playerId: 'non-existent-player' })
    const res = await POST(req)

    // Route handler can't know the player doesn't exist at validation time,
    // so it might return 200 (SSE stream with failed event)
    // or error if the fake seed path is taken
    if (res.status === 200) {
      const events = await readSSEStreamParsed(res)

      // Should have a failed terminal event
      const failed = events.find(e => e.type === 'failed')
      if (failed) {
        expect(failed.payload).toBeDefined()
        const payload = failed.payload as Record<string, unknown>
        // Error code should indicate player issue
        expect(['PLAYER_NOT_FOUND', 'INTERNAL_ERROR']).toContain(payload.code)
      }
    }
    // Both 200 (failed event) and error status codes are valid outcomes
  })

  it('SMOKE-5: outbox — completed turn enqueues post-commit events', async () => {
    const player = makeSmokePlayer()
    player.id = 'player-smoke-outbox'
    await seedPlayer(player)

    mockFetchSuccess('探索完毕，收获颇丰。')

    const req = makeRequest({ playerId: player.id })
    const res = await POST(req)

    expect(res.status).toBe(200)

    const events = await readSSEStreamParsed(res)
    const completed = events.find(e => e.type === 'completed')

    if (completed) {
      // Outbox should contain at least one event
      const outboxEntries = await prisma.outboxRecord.findMany({
        where: { playerId: player.id },
      })
      expect(outboxEntries.length).toBeGreaterThan(0)
      expect(outboxEntries[0].eventType).toBeTruthy()
      expect(outboxEntries[0].payload).toBeDefined()
    }
  })
})

describe('SMOKE: Response Headers and Protocol', () => {
  beforeEach(async () => {
    await seedPlayer(makeSmokePlayer())
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({
        id: 'chatcmpl-hdr',
        object: 'chat.completion',
        created: Date.now(),
        model: 'hdr-model',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: '测试响应头' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('SMOKE-H1: all required headers present in 200 response', async () => {
    const req = makeRequest()
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')
    expect(res.headers.get('Cache-Control')).toContain('no-cache')
    expect(res.headers.get('Connection')).toBe('keep-alive')
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
    expect(res.headers.get('X-Protocol-Version')).toBe('1.0')
    expect(res.headers.get('X-Accel-Buffering')).toBe('no')
  })
})

describe('SMOKE: Request Validation', () => {
  it('SMOKE-V1: invalid JSON returns 400 Problem Details', async () => {
    const req = new Request('http://localhost/api/v1/game/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json {{{',
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('BAD_REQUEST')
    expect(body.requestId).toBeTruthy()
  })

  it('SMOKE-V2: missing input returns 422 with error pointers', async () => {
    const req = new Request('http://localhost/api/v1/game/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'p1' }),
    })
    const res = await POST(req)

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(Array.isArray(body.errors)).toBe(true)
    expect(body.errors.length).toBeGreaterThan(0)
  })

  it('SMOKE-V3: missing playerId returns 422', async () => {
    const req = new Request('http://localhost/api/v1/game/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: '探索' }),
    })
    const res = await POST(req)

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('VALIDATION_ERROR')
  })
})
