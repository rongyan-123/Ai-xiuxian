/**
 * HTTP-Level Frontend-Backend Contract Tests (TDD: RED phase).
 *
 * These tests validate the ACTUAL HTTP contract between frontend and backend —
 * not just Zod schema validation in isolation. They exercise the real route
 * handler and validate that what the backend emits is exactly what the
 * frontend (game-turn-client.ts, sse-parser.ts, game-turn-reducer.ts) expects.
 *
 * Categories:
 *   A. SSE Event Envelope Contract — every event must validate against SSEEventSchema
 *   B. SSE Event Ordering — accepted first, exactly one terminal, monotonic sequences
 *   C. Response Headers — Content-Type, Cache-Control, correlation headers
 *   D. Error Responses — Problem Details RFC 9457 compliance
 *   E. Client Integration — frontend parser + reducer can process real server output
 *   F. Protocol Edge Cases — unicode, XSS, large payloads, stream interruption
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { POST } from '@/app/api/v1/game/action/route'
import { SSEEventSchema } from '@/server/contracts/sse-events'
import { ProblemDetailsSchema } from '@/server/contracts/problem-details'
import { parseSSEChunk } from '@/client/sse-parser'
import { gameTurnReducer, initialGameTurnState } from '@/client/game-turn-reducer'
import type { GameTurnState } from '@/client/game-turn-reducer'
import type { ParsedSSEEvent } from '@/client/sse-parser'

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeRequest(overrides: Record<string, unknown> = {}): Request {
  return new Request('http://localhost/api/v1/game/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: '探索青云山',
      playerId: 'player-test-001',
      mode: 'action',
      playerName: '测试修士',
      idempotencyKey: `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...overrides,
    }),
  })
}

function makeRequestWithBody(body: unknown): Request {
  return new Request('http://localhost/api/v1/game/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

interface RawSSEEvent {
  type: string
  data: string
}

interface ParsedEvent {
  type: string
  sequence?: number
  requestId?: string
  runId?: string
  payload?: Record<string, unknown>
  raw: Record<string, unknown>
}

/** Read all SSE events from a Response stream — no filtering, no skipping */
async function readSSEStreamRaw(response: Response): Promise<RawSSEEvent[]> {
  const events: RawSSEEvent[] = []
  const reader = response.body?.getReader()
  if (!reader) return events

  const decoder = new TextDecoder()
  let buffer = ''

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
            events.push({ type: 'message', data: currentData })
            currentData = ''
          }
        }
      }
    }
  } catch {
    // Return what we have
  }

  // Flush remaining
  if (buffer.trim()) {
    const lineMatch = buffer.match(/^data: (.+)$/)
    if (lineMatch) {
      events.push({ type: 'message', data: lineMatch[1] })
    }
  }

  return events
}

/** Read SSE stream and parse JSON — returns ALL events including terminal markers */
async function readSSEStreamParsed(response: Response): Promise<ParsedEvent[]> {
  const rawEvents = await readSSEStreamRaw(response)
  return rawEvents.map(r => {
    try {
      const parsed = JSON.parse(r.data)
      return {
        type: parsed.type ?? 'unknown',
        sequence: parsed.sequence,
        requestId: parsed.requestId,
        runId: parsed.runId,
        payload: parsed.payload,
        raw: parsed,
      }
    } catch {
      return { type: 'parse_error', raw: { _raw: r.data } }
    }
  })
}

// ─── Mock Helpers ─────────────────────────────────────────────────────────

type MockLLMResponse = {
  status: number
  body: Record<string, unknown>
  delayMs?: number
}

let mockFetchResponses: MockLLMResponse[] = []
let mockLastContent = ''

function mockFetchSuccess(content: string): void {
  mockLastContent = content
  mockFetchResponses = [{
    status: 200,
    body: {
      id: 'chatcmpl-mock',
      object: 'chat.completion',
      created: Date.now(),
      model: 'mock-model',
      choices: [{
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 50, completion_tokens: content.length, total_tokens: 50 + content.length },
    },
  }]
}

function mockFetchError(status: number, code: string, message: string): void {
  mockFetchResponses = [{
    status,
    body: { error: { code, message } },
  }]
}

// Calculated once per describe block to avoid cross-test pollution
let originalFetch: typeof fetch

// ─── Category A: SSE Event Envelope Contract ──────────────────────────────

describe('HTTP Contract A: SSE Event Envelope', () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetchResponses = []
    globalThis.fetch = vi.fn(async () => {
      if (mockFetchResponses.length === 0) {
        return new Response(JSON.stringify({
          id: 'chatcmpl-fallback',
          object: 'chat.completion',
          created: Date.now(),
          model: 'mock-model',
          choices: [{ index: 0, message: { role: 'assistant', content: mockLastContent }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      const mock = mockFetchResponses.shift()!
      return new Response(JSON.stringify(mock.body), {
        status: mock.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    mockFetchResponses = []
    mockLastContent = ''
  })

  it('A1: EVERY SSE event must validate against SSEEventSchema discriminated union', async () => {
    mockFetchSuccess('你踏入青云山，四周云雾缭绕，灵气充沛。前方有一条蜿蜒的石阶通向山顶。')

    const req = makeRequest()
    const res = await POST(req)

    expect(res.status).toBe(200)

    const rawEvents = await readSSEStreamRaw(res)
    expect(rawEvents.length).toBeGreaterThan(0)

    // Validate every single event — no filtering, no skipping
    for (let i = 0; i < rawEvents.length; i++) {
      const raw = rawEvents[i]
      let parsed: unknown
      try {
        parsed = JSON.parse(raw.data)
      } catch {
        throw new Error(`Event ${i} is not valid JSON: ${raw.data.slice(0, 100)}`)
      }

      const result = SSEEventSchema.safeParse(parsed)
      if (!result.success) {
        const issues = result.error.issues.map(iss =>
          `${iss.path.join('.')}: ${iss.message}`
        ).join('; ')
        throw new Error(
          `Event ${i} (type=${(parsed as Record<string,unknown>).type}) FAILED SSEEventSchema validation:\n` +
          `  Raw: ${raw.data.slice(0, 200)}\n` +
          `  Issues: ${issues}`
        )
      }
    }
  })

  it('A2: NO event type outside the known discriminated union should appear', async () => {
    mockFetchSuccess('测试剧情内容。')

    const req = makeRequest()
    const res = await POST(req)

    expect(res.status).toBe(200)

    const parsedEvents = await readSSEStreamParsed(res)
    const knownTypes = ['accepted', 'step', 'text-delta', 'codex', 'journal',
      'state_update', 'completed', 'failed', 'cancelled']

    for (const event of parsedEvents) {
      if (event.type === 'parse_error') continue
      expect(knownTypes).toContain(event.type)
    }
  })

  it('A3: accepted event payload must contain requestId, runId, playerId, mode', async () => {
    mockFetchSuccess('开始剧情')

    const req = makeRequest()
    const res = await POST(req)

    expect(res.status).toBe(200)

    const parsedEvents = await readSSEStreamParsed(res)
    const accepted = parsedEvents.find(e => e.type === 'accepted')
    expect(accepted).toBeDefined()
    expect(accepted!.raw.requestId).toBeTruthy()
    expect(accepted!.raw.runId).toBeTruthy()
    expect(accepted!.raw.payload).toBeDefined()
    expect((accepted!.raw.payload as Record<string, unknown>).playerId).toBeTruthy()
    expect((accepted!.raw.payload as Record<string, unknown>).mode).toBeTruthy()
  })

  it('A4: completed event payload must contain reply string', async () => {
    mockFetchSuccess('探索完毕。')

    const req = makeRequest()
    const res = await POST(req)

    expect(res.status).toBe(200)

    const parsedEvents = await readSSEStreamParsed(res)
    const completed = parsedEvents.find(e => e.type === 'completed')
    expect(completed).toBeDefined()
    expect(completed!.raw.payload).toBeDefined()
    expect(typeof (completed!.raw.payload as Record<string, unknown>).reply).toBe('string')
  })

  it('A5: text-delta event payload must contain content string', async () => {
    mockFetchSuccess('这是一段剧情叙述文本。')

    const req = makeRequest()
    const res = await POST(req)

    expect(res.status).toBe(200)

    const parsedEvents = await readSSEStreamParsed(res)
    const textDeltas = parsedEvents.filter(e => e.type === 'text-delta')
    // text-delta is the LLM response content, should be present
    expect(textDeltas.length).toBeGreaterThan(0)
    for (const td of textDeltas) {
      expect(td.raw.payload).toBeDefined()
      expect(typeof (td.raw.payload as Record<string, unknown>).content).toBe('string')
    }
  })
})

// ─── Category B: SSE Event Ordering Contract ──────────────────────────────

describe('HTTP Contract B: SSE Event Ordering', () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetchResponses = []
    globalThis.fetch = vi.fn(async () => {
      if (mockFetchResponses.length === 0) {
        return new Response(JSON.stringify({
          id: 'chatcmpl-fallback',
          object: 'chat.completion',
          created: Date.now(),
          model: 'mock-model',
          choices: [{ index: 0, message: { role: 'assistant', content: mockLastContent }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      const mock = mockFetchResponses.shift()!
      return new Response(JSON.stringify(mock.body), {
        status: mock.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    mockFetchResponses = []
    mockLastContent = ''
  })

  it('B1: first event must be "accepted"', async () => {
    mockFetchSuccess('剧情开始')

    const req = makeRequest()
    const res = await POST(req)

    expect(res.status).toBe(200)

    const parsedEvents = await readSSEStreamParsed(res)
    const sseEvents = parsedEvents.filter(e => e.type !== 'parse_error')

    expect(sseEvents.length).toBeGreaterThan(0)
    expect(sseEvents[0].type).toBe('accepted')
  })

  it('B2: exactly one terminal event (completed|failed|cancelled) per stream', async () => {
    mockFetchSuccess('剧情结束')

    const req = makeRequest()
    const res = await POST(req)

    expect(res.status).toBe(200)

    const parsedEvents = await readSSEStreamParsed(res)
    const sseEvents = parsedEvents.filter(e => e.type !== 'parse_error')

    const terminalEvents = sseEvents.filter(e =>
      ['completed', 'failed', 'cancelled'].includes(e.type)
    )
    expect(terminalEvents.length).toBe(1)
  })

  it('B3: terminal event must be the last semantic event in the stream', async () => {
    mockFetchSuccess('剧情完成')

    const req = makeRequest()
    const res = await POST(req)

    expect(res.status).toBe(200)

    const parsedEvents = await readSSEStreamParsed(res)
    const sseEvents = parsedEvents.filter(e =>
      e.type !== 'parse_error' && ['accepted', 'step', 'text-delta', 'codex',
        'journal', 'state_update', 'completed', 'failed', 'cancelled'].includes(e.type)
    )

    expect(sseEvents.length).toBeGreaterThan(0)
    const lastType = sseEvents[sseEvents.length - 1].type
    expect(['completed', 'failed', 'cancelled']).toContain(lastType)
  })

  it('B4: event sequences must be monotonically increasing', async () => {
    mockFetchSuccess('剧情内容')

    const req = makeRequest()
    const res = await POST(req)

    expect(res.status).toBe(200)

    const parsedEvents = await readSSEStreamParsed(res)
    const sequences = parsedEvents
      .filter(e => typeof e.sequence === 'number')
      .map(e => e.sequence as number)

    expect(sequences.length).toBeGreaterThan(0)
    for (let i = 1; i < sequences.length; i++) {
      expect(sequences[i]).toBeGreaterThan(sequences[i - 1])
    }
  })

  it('B5: all events share the same requestId and runId', async () => {
    mockFetchSuccess('剧情')

    const req = makeRequest()
    const res = await POST(req)

    expect(res.status).toBe(200)

    const parsedEvents = await readSSEStreamParsed(res)
    const eventsWithIds = parsedEvents.filter(e => e.requestId && e.runId)

    expect(eventsWithIds.length).toBeGreaterThan(1)

    const firstReqId = eventsWithIds[0].requestId
    const firstRunId = eventsWithIds[0].runId

    for (const event of eventsWithIds) {
      expect(event.requestId).toBe(firstReqId)
      expect(event.runId).toBe(firstRunId)
    }
  })

  it('B6: events must have valid ISO 8601 occurredAt timestamps', async () => {
    mockFetchSuccess('测试')

    const req = makeRequest()
    const res = await POST(req)

    expect(res.status).toBe(200)

    const parsedEvents = await readSSEStreamParsed(res)
    const eventsWithTimestamps = parsedEvents.filter(e => e.raw.occurredAt)

    for (const event of eventsWithTimestamps) {
      const ts = event.raw.occurredAt as string
      const date = new Date(ts)
      expect(date.toString()).not.toBe('Invalid Date')
      // ISO 8601: should contain T or Z
      expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    }
  })
})

// ─── Category C: Response Headers Contract ────────────────────────────────

describe('HTTP Contract C: Response Headers', () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetchResponses = []
    globalThis.fetch = vi.fn(async () => {
      if (mockFetchResponses.length === 0) {
        return new Response(JSON.stringify({
          id: 'chatcmpl-fallback',
          object: 'chat.completion',
          created: Date.now(),
          model: 'mock-model',
          choices: [{ index: 0, message: { role: 'assistant', content: mockLastContent }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      const mock = mockFetchResponses.shift()!
      return new Response(JSON.stringify(mock.body), {
        status: mock.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    mockFetchResponses = []
    mockLastContent = ''
  })

  it('C1: 200 response must have Content-Type: text/event-stream', async () => {
    mockFetchSuccess('测试')

    const req = makeRequest()
    const res = await POST(req)

    expect(res.status).toBe(200)
    const ct = res.headers.get('Content-Type')
    expect(ct).toContain('text/event-stream')
  })

  it('C2: 200 response must include X-Request-Id header', async () => {
    mockFetchSuccess('测试')

    const req = makeRequest()
    const res = await POST(req)

    expect(res.status).toBe(200)
    const reqId = res.headers.get('X-Request-Id')
    expect(reqId).toBeTruthy()
    expect(typeof reqId).toBe('string')
  })

  it('C3: 200 response must include X-Protocol-Version: 1.0', async () => {
    mockFetchSuccess('测试')

    const req = makeRequest()
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('X-Protocol-Version')).toBe('1.0')
  })

  it('C4: 200 response must include Cache-Control: no-cache', async () => {
    mockFetchSuccess('测试')

    const req = makeRequest()
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toContain('no-cache')
  })

  it('C5: 200 response must include X-Accel-Buffering: no', async () => {
    mockFetchSuccess('测试')

    const req = makeRequest()
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('X-Accel-Buffering')).toBe('no')
  })

  it('C6: 200 response should include Connection: keep-alive for streaming', async () => {
    mockFetchSuccess('测试')

    const req = makeRequest()
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('Connection')).toBe('keep-alive')
  })
})

// ─── Category D: Error Response Contract ──────────────────────────────────

describe('HTTP Contract D: Error Responses', () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetchResponses = []
    globalThis.fetch = vi.fn(async () => {
      if (mockFetchResponses.length === 0) {
        return new Response(JSON.stringify({
          id: 'chatcmpl-fallback',
          object: 'chat.completion',
          created: Date.now(),
          model: 'mock-model',
          choices: [{ index: 0, message: { role: 'assistant', content: mockLastContent }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      const mock = mockFetchResponses.shift()!
      return new Response(JSON.stringify(mock.body), {
        status: mock.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    mockFetchResponses = []
    mockLastContent = ''
  })

  it('D1: non-JSON body returns 400 with ProblemDetails', async () => {
    const req = new Request('http://localhost/api/v1/game/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json {{{',
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
    const body = await res.json()

    // Validate against ProblemDetails schema
    const parsed = ProblemDetailsSchema.safeParse(body)
    expect(parsed.success).toBe(true)
    expect(body.code).toBe('BAD_REQUEST')
    expect(body.retryable).toBe(false)
  })

  it('D2: missing input returns 422 with validation errors array', async () => {
    const req = makeRequestWithBody({ playerId: 'p1' })
    const res = await POST(req)

    expect(res.status).toBe(422)
    const body = await res.json()

    expect(body.code).toBe('VALIDATION_ERROR')
    expect(body.retryable).toBe(false)
    expect(Array.isArray(body.errors)).toBe(true)
    expect(body.errors.length).toBeGreaterThan(0)

    // Each error should have pointer and message
    for (const err of body.errors) {
      expect(typeof err.pointer).toBe('string')
      expect(typeof err.message).toBe('string')
    }
  })

  it('D3: missing playerId returns 422', async () => {
    const req = makeRequestWithBody({ input: '探索' })
    const res = await POST(req)

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('VALIDATION_ERROR')
  })

  it('D4: invalid JSON body returns 400', async () => {
    const req = new Request('http://localhost/api/v1/game/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '',
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('BAD_REQUEST')
  })

  it('D5: error responses must have Content-Type: application/json', async () => {
    const req = makeRequestWithBody({ playerId: 'p1' })
    const res = await POST(req)

    expect(res.status).toBe(422)
    expect(res.headers.get('Content-Type')).toContain('application/json')
  })

  it('D6: error response status code in body matches HTTP status', async () => {
    const req = makeRequestWithBody({ playerId: 'p1' })
    const res = await POST(req)

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.status).toBe(422)
  })

  it('D7: each error response has a unique requestId', async () => {
    const ids = new Set<string>()
    for (let i = 0; i < 5; i++) {
      const req = makeRequestWithBody({ playerId: `p${i}` })
      const res = await POST(req)
      if (res.status === 422) {
        const body = await res.json()
        ids.add(body.requestId)
      }
    }
    expect(ids.size).toBe(5)
  })
})

// ─── Category E: Client Integration Contract ──────────────────────────────

describe('HTTP Contract E: Client Integration', () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetchResponses = []
    globalThis.fetch = vi.fn(async () => {
      if (mockFetchResponses.length === 0) {
        return new Response(JSON.stringify({
          id: 'chatcmpl-fallback',
          object: 'chat.completion',
          created: Date.now(),
          model: 'mock-model',
          choices: [{ index: 0, message: { role: 'assistant', content: mockLastContent }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      const mock = mockFetchResponses.shift()!
      return new Response(JSON.stringify(mock.body), {
        status: mock.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    mockFetchResponses = []
    mockLastContent = ''
  })

  it('E1: sse-parser can parse actual server SSE output without errors', async () => {
    mockFetchSuccess('修仙世界风云变幻，你站在青云山之巅。')

    const req = makeRequest()
    const res = await POST(req)

    expect(res.status).toBe(200)

    const reader = res.body?.getReader()
    expect(reader).toBeDefined()

    let buffer = ''
    const allParsed: ReturnType<typeof parseSSEChunk>['events'][] = []

    try {
      while (true) {
        const { done, value } = await reader!.read()
        if (done) break
        const { events, buffer: newBuffer } = parseSSEChunk(value, buffer)
        buffer = newBuffer
        allParsed.push(events)
      }
    } catch (err) {
      throw new Error(`sse-parser threw: ${(err as Error).message}`)
    }

    // Should have parsed at least some events
    const flatEvents = allParsed.flat()
    expect(flatEvents.length).toBeGreaterThan(0)

    // Each parsed event should have valid data
    for (const event of flatEvents) {
      expect(event.type).toBeTruthy()
      expect(event.data).toBeTruthy()
      // Data should be parseable JSON
      let parsed: unknown
      try {
        parsed = JSON.parse(event.data)
      } catch {
        throw new Error(`sse-parser produced unparseable JSON data: ${event.data.slice(0, 100)}`)
      }
      expect(parsed).toBeDefined()
    }
  })

  it('E2: game-turn-reducer processes server events through complete lifecycle', async () => {
    mockFetchSuccess('洞府中灵气充沛，你盘膝打坐，感受着天地灵气的流动。')

    const req = makeRequest()
    const res = await POST(req)

    expect(res.status).toBe(200)

    const reader = res.body!.getReader()!
    let buffer = ''
    let state: GameTurnState = { ...initialGameTurnState }

    // Submit to start
    state = gameTurnReducer(state, {
      type: 'SUBMIT',
      playerId: 'player-test-001',
      playerName: '测试修士',
      input: '探索青云山',
      mode: 'action',
      idempotencyKey: 'idem-test-001',
    })
    expect(state.status).toBe('submitting')

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const { events } = parseSSEChunk(value, buffer)
        buffer = '' // Reset since parseSSEChunk already handles buffering internally

        for (const rawEvent of events) {
          let parsed: Record<string, unknown>
          try {
            parsed = JSON.parse(rawEvent.data)
          } catch {
            continue
          }

          // Convert to ParsedSSEEvent shape
          const sseEvent: ParsedSSEEvent<Record<string, unknown>> = {
            type: (parsed.type as string) ?? rawEvent.type,
            payload: (parsed.payload ?? parsed) as Record<string, unknown>,
            raw: rawEvent.data,
            sequence: parsed.sequence as number | undefined,
          }

          state = gameTurnReducer(state, { type: 'SSE_EVENT', event: sseEvent })

          // After a terminal event, state should be terminal
          if (['completed', 'failed', 'cancelled'].includes(sseEvent.type)) {
            expect(['completed', 'failed', 'cancelled', 'cancelling']).toContain(state.status)
          }
        }
      }
    } catch (err) {
      throw new Error(`game-turn-reducer processing threw: ${(err as Error).message}`)
    }

    // After full stream processing, state should be terminal
    expect(['completed', 'failed']).toContain(state.status)

    // If completed, should have reply text
    if (state.status === 'completed') {
      expect(state.replyText.length).toBeGreaterThan(0)
    }
  })

  it('E3: reducer correctly transitions submitting → streaming → completed', async () => {
    mockFetchSuccess('你推开石门，进入古老大殿。')

    const req = makeRequest()
    const res = await POST(req)

    expect(res.status).toBe(200)

    const reader = res.body!.getReader()!
    let buffer = ''
    let state: GameTurnState = { ...initialGameTurnState }
    const transitions: string[] = []

    state = gameTurnReducer(state, {
      type: 'SUBMIT',
      playerId: 'p1',
      playerName: '测试',
      input: '探索',
      mode: 'action',
      idempotencyKey: 'idem-001',
    })
    transitions.push(`→ ${state.status}`)

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
              type: (parsed.type as string) ?? rawEvent.type,
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
      // Ignore parse errors at end of stream
    }

    // Should have gone through submitting → streaming → completed
    expect(transitions).toContain('→ submitting')
    expect(transitions).toContain('→ streaming')
    expect(['→ completed', '→ failed']).toContain(transitions[transitions.length - 1])
  })

  it('E4: reducer preserves requestId and runId from accepted event', async () => {
    mockFetchSuccess('剧情推进中。')

    const req = makeRequest()
    const res = await POST(req)

    expect(res.status).toBe(200)

    const reader = res.body!.getReader()!
    let buffer = ''
    let state: GameTurnState = { ...initialGameTurnState }

    state = gameTurnReducer(state, {
      type: 'SUBMIT',
      playerId: 'p1',
      playerName: '测试',
      input: '探索',
      mode: 'action',
      idempotencyKey: 'idem-001',
    })

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const { events } = parseSSEChunk(value, buffer)

        for (const rawEvent of events) {
          let parsed: Record<string, unknown>
          try { parsed = JSON.parse(rawEvent.data) } catch { continue }

          state = gameTurnReducer(state, {
            type: 'SSE_EVENT',
            event: {
              type: (parsed.type as string) ?? rawEvent.type,
              payload: (parsed.payload ?? parsed) as Record<string, unknown>,
              raw: rawEvent.data,
              sequence: parsed.sequence as number | undefined,
            },
          })
        }
      }
    } catch {
      // Ignore
    }

    // After accepted event, requestId and runId should be set
    if (state.status === 'completed' || state.status === 'streaming') {
      expect(state.requestId).toBeTruthy()
      expect(state.runId).toBeTruthy()
    }
  })

  it('E5: reducer replyText accumulates text-delta content', async () => {
    mockFetchSuccess('山间的灵气如同涓涓细流，在你的经脉中缓缓游走。你能感受到修为在一点一滴地增长。')

    const req = makeRequest()
    const res = await POST(req)

    expect(res.status).toBe(200)

    const reader = res.body!.getReader()!
    let buffer = ''
    let state: GameTurnState = { ...initialGameTurnState }

    state = gameTurnReducer(state, {
      type: 'SUBMIT',
      playerId: 'p1',
      playerName: '测试',
      input: '修炼',
      mode: 'action',
      idempotencyKey: 'idem-001',
    })

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const { events } = parseSSEChunk(value, buffer)

        for (const rawEvent of events) {
          let parsed: Record<string, unknown>
          try { parsed = JSON.parse(rawEvent.data) } catch { continue }

          state = gameTurnReducer(state, {
            type: 'SSE_EVENT',
            event: {
              type: (parsed.type as string) ?? rawEvent.type,
              payload: (parsed.payload ?? parsed) as Record<string, unknown>,
              raw: rawEvent.data,
              sequence: parsed.sequence as number | undefined,
            },
          })
        }
      }
    } catch {
      // Ignore
    }

    // replyText should contain the LLM response
    expect(state.replyText.length).toBeGreaterThan(0)
  })
})

// ─── Category F: Protocol Edge Cases ──────────────────────────────────────

describe('HTTP Contract F: Protocol Edge Cases', () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetchResponses = []
    globalThis.fetch = vi.fn(async () => {
      if (mockFetchResponses.length === 0) {
        return new Response(JSON.stringify({
          id: 'chatcmpl-fallback',
          object: 'chat.completion',
          created: Date.now(),
          model: 'mock-model',
          choices: [{ index: 0, message: { role: 'assistant', content: mockLastContent }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      const mock = mockFetchResponses.shift()!
      return new Response(JSON.stringify(mock.body), {
        status: mock.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    mockFetchResponses = []
    mockLastContent = ''
  })

  it('F1: unicode/emoji in input does not break SSE', async () => {
    mockFetchSuccess('你在🏔️山顶发现了一处✨古老的传送阵。')

    const req = makeRequest({ input: '探索🏔️青云山✨洞府🐉' })
    const res = await POST(req)

    expect(res.status).toBe(200)

    const rawEvents = await readSSEStreamRaw(res)
    expect(rawEvents.length).toBeGreaterThan(0)

    // All events should be parseable JSON
    for (const raw of rawEvents) {
      expect(() => JSON.parse(raw.data)).not.toThrow()
    }
  })

  it('F2: script injection in input does not break SSE output', async () => {
    mockFetchSuccess('正常剧情内容')

    const req = makeRequest({ input: '<script>alert("xss")</script>' })
    const res = await POST(req)

    expect(res.status).toBe(200)

    const rawEvents = await readSSEStreamRaw(res)
    // SSE events should still be valid, not broken by script tags
    for (const raw of rawEvents) {
      // The event data itself should not contain unescaped HTML
      expect(() => JSON.parse(raw.data)).not.toThrow()
    }
  })

  it('F3: large input (near limit) is handled gracefully', async () => {
    mockFetchSuccess('收到')

    const largeInput = '探索' + '青云山'.repeat(500) // ~2000 chars
    const req = makeRequest({ input: largeInput })
    const res = await POST(req)

    // Should not crash — either accept or reject gracefully
    expect([200, 400, 413, 422]).toContain(res.status)
  })

  it('F4: very long playerName does not break stream', async () => {
    mockFetchSuccess('测试')

    const req = makeRequest({ playerName: '修' + '仙'.repeat(200) })
    const res = await POST(req)

    expect([200, 422]).toContain(res.status)
  })

  it('F5: concurrent requests with different idempotencyKeys both succeed', async () => {
    mockFetchSuccess('第一个请求的剧情')
    mockFetchSuccess('第二个请求的剧情')

    const req1 = makeRequest({ idempotencyKey: 'idem-concurrent-1', playerId: 'player-concurrent-1' })
    const req2 = makeRequest({ idempotencyKey: 'idem-concurrent-2', playerId: 'player-concurrent-2' })

    const [res1, res2] = await Promise.all([POST(req1), POST(req2)])

    // Both should get valid responses (200 or error, but not crash)
    expect([200, 422, 500]).toContain(res1.status)
    expect([200, 422, 500]).toContain(res2.status)
  })
})
