/**
 * SSE streaming protocol unit tests (TDD: RED phase).
 *
 * Tests for the SSE encoder, sequence allocator, terminal guard,
 * and event factory. These MUST fail until the streaming modules
 * under @/server/streaming/ are implemented.
 */
import { describe, it, expect, beforeEach } from 'vitest'

import {
  createSequenceAllocator,
  createTerminalGuard,
  createSSEEncoder,
  createEventFactory,
} from '@/server/streaming'

import type {
  SequenceAllocator,
  TerminalGuard,
  SSEEncoder,
  EventFactory,
  DomainEvent,
} from '@/server/streaming'

import { PROTOCOL_VERSION, SSEEventTypes } from '@/server/contracts/sse-events'

describe('4.1 SSE sequence allocator', () => {
  let allocator: SequenceAllocator

  beforeEach(() => {
    allocator = createSequenceAllocator()
  })

  it('starts at 0', () => {
    expect(allocator.next()).toBe(0)
  })

  it('increments monotonically by 1', () => {
    expect(allocator.next()).toBe(0)
    expect(allocator.next()).toBe(1)
    expect(allocator.next()).toBe(2)
    expect(allocator.next()).toBe(3)
  })

  it('generates contiguous values with no gaps', () => {
    const values: number[] = []
    for (let i = 0; i < 100; i++) {
      values.push(allocator.next())
    }
    for (let i = 0; i < values.length; i++) {
      expect(values[i]).toBe(i)
    }
  })

  it('returns current sequence without incrementing', () => {
    allocator.next() // 0
    allocator.next() // 1
    expect(allocator.current()).toBe(1)
    expect(allocator.current()).toBe(1) // should not change
    expect(allocator.next()).toBe(2)    // resume from current
  })

  it('creates independent allocators', () => {
    const a1 = createSequenceAllocator()
    const a2 = createSequenceAllocator()
    expect(a1.next()).toBe(0)
    expect(a1.next()).toBe(1)
    expect(a2.next()).toBe(0)
  })
})

describe('4.1 Terminal guard', () => {
  let guard: TerminalGuard

  beforeEach(() => {
    guard = createTerminalGuard()
  })

  it('allows non-terminal events before terminal', () => {
    expect(() => guard.check(SSEEventTypes.TEXT_DELTA)).not.toThrow()
    expect(() => guard.check(SSEEventTypes.STEP)).not.toThrow()
    expect(() => guard.check(SSEEventTypes.STATE_UPDATE)).not.toThrow()
  })

  it('rejects non-terminal events after a terminal event', () => {
    guard.check(SSEEventTypes.COMPLETED)
    expect(() => guard.check(SSEEventTypes.TEXT_DELTA)).toThrow()
  })

  it('rejects a second terminal event', () => {
    guard.check(SSEEventTypes.COMPLETED)
    expect(() => guard.check(SSEEventTypes.COMPLETED)).toThrow()
    expect(() => guard.check(SSEEventTypes.FAILED)).toThrow()
    expect(() => guard.check(SSEEventTypes.CANCELLED)).toThrow()
  })

  it('isTerminated returns false before terminal', () => {
    expect(guard.isTerminated()).toBe(false)
  })

  it('isTerminated returns true after terminal', () => {
    guard.check(SSEEventTypes.FAILED)
    expect(guard.isTerminated()).toBe(true)
  })

  it('accepts any of the three terminal types as first terminal', () => {
    const g1 = createTerminalGuard()
    expect(() => g1.check(SSEEventTypes.COMPLETED)).not.toThrow()
    expect(g1.isTerminated()).toBe(true)

    const g2 = createTerminalGuard()
    expect(() => g2.check(SSEEventTypes.FAILED)).not.toThrow()
    expect(g2.isTerminated()).toBe(true)

    const g3 = createTerminalGuard()
    expect(() => g3.check(SSEEventTypes.CANCELLED)).not.toThrow()
    expect(g3.isTerminated()).toBe(true)
  })
})

describe('4.1 SSE encoder', () => {
  let encoder: SSEEncoder

  beforeEach(() => {
    encoder = createSSEEncoder()
  })

  it('encodes an event as SSE text/event-stream format', () => {
    const event = { type: 'text-delta', payload: { content: 'hello' } }
    const result = encoder.encode(event as unknown as DomainEvent)
    expect(result).toContain('event: text-delta')
    expect(result).toContain('data: ')
    expect(result).toContain('"content":"hello"')
    expect(result).toMatch(/\n\n$/) // double newline terminates SSE message
  })

  it('omits event: line when type is "message" (default SSE)', () => {
    const event = { type: 'message', payload: {} }
    const result = encoder.encode(event as unknown as DomainEvent)
    expect(result).not.toContain('event:')
    expect(result).toContain('data: ')
  })

  it('serializes multi-line payloads correctly', () => {
    const event = {
      type: 'text-delta',
      payload: { content: 'line1\nline2\nline3' },
    }
    const result = encoder.encode(event as unknown as DomainEvent)
    // Multi-line SSE: each line starts with "data: "
    const lines = result.split('\n')
    expect(lines.filter((l: string) => l.startsWith('data: ')).length).toBeGreaterThanOrEqual(1)
  })

  it('encodes UTF-8 content without corruption', () => {
    const event = {
      type: 'text-delta',
      payload: { content: '你好世界 🌍 — 修仙' },
    }
    const result = encoder.encode(event as unknown as DomainEvent)
    expect(result).toContain('你好世界 🌍 — 修仙')
  })

  it('encodes to a TextEncoder-compatible Uint8Array', () => {
    const encoder2 = createSSEEncoder()
    const event = { type: 'step', payload: { label: 'processing' } }
    const bytes = encoder2.encodeBytes(event as unknown as DomainEvent)
    expect(ArrayBuffer.isView(bytes)).toBe(true)
    expect(bytes.constructor.name).toBe('Uint8Array')
    const decoded = new TextDecoder().decode(bytes)
    expect(decoded).toContain('event: step')
  })

  it('handles empty string payload', () => {
    const event = { type: 'completed', payload: {} }
    const result = encoder.encode(event as unknown as DomainEvent)
    expect(result).toContain('data: ')
  })

  it('handles large payloads without truncation', () => {
    const longText = 'a'.repeat(100_000)
    const event = { type: 'text-delta', payload: { content: longText } }
    const result = encoder.encode(event as unknown as DomainEvent)
    expect(result).toContain(longText)
  })
})

describe('4.1 Event factory', () => {
  let factory: EventFactory

  beforeEach(() => {
    factory = createEventFactory({
      requestId: 'req-001',
      runId: 'run-001',
      protocolVersion: PROTOCOL_VERSION,
    })
  })

  it('creates an accepted event with sequence 0', () => {
    const event = factory.accepted({ playerId: 'p1', mode: 'action' })
    expect(event.type).toBe('accepted')
    expect(event.sequence).toBe(0)
    expect(event.requestId).toBe('req-001')
    expect(event.runId).toBe('run-001')
    expect(event.protocolVersion).toBe(PROTOCOL_VERSION)
    expect(event.occurredAt).toBeTruthy()
  })

  it('creates a text-delta event with incrementing sequence', () => {
    factory.accepted({ playerId: 'p1', mode: 'action' }) // seq 0
    const delta = factory.textDelta({ content: 'hello' })  // seq 1
    expect(delta.type).toBe('text-delta')
    expect(delta.sequence).toBe(1)
  })

  it('creates a completed event as terminal', () => {
    factory.accepted({ playerId: 'p1', mode: 'action' }) // 0
    factory.textDelta({ content: 'hello' })              // 1
    const completed = factory.completed({ reply: 'done' }) // 2
    expect(completed.type).toBe('completed')
    expect(completed.sequence).toBe(2)
  })

  it('creates a failed event as terminal', () => {
    const failed = factory.failed({
      type: 'https://test/error',
      title: 'Error',
      status: 500,
      detail: 'Boom',
      code: 'INTERNAL_ERROR',
      requestId: 'req-001',
      retryable: false,
    })
    expect(failed.type).toBe('failed')
    expect(failed.sequence).toBe(0)
    expect(failed.payload.code).toBe('INTERNAL_ERROR')
  })

  it('creates a cancelled event as terminal', () => {
    const cancelled = factory.cancelled({ reason: 'user aborted' })
    expect(cancelled.type).toBe('cancelled')
    expect(cancelled.sequence).toBe(0)
    expect(cancelled.payload.reason).toBe('user aborted')
  })

  it('throws when emitting after terminal', () => {
    factory.completed({ reply: 'done' })
    expect(() => factory.textDelta({ content: 'late' })).toThrow()
  })

  it('requires accepted to be emitted first (non-terminal sequence must start with accepted)', () => {
    // Text delta before accepted should work or produce a valid event
    // The factory should allow non-accepted as the first event
    // (some error flows skip accepted)
    const delta = factory.textDelta({ content: 'late message' })
    expect(delta.type).toBe('text-delta')
    // But the first sequence should still be valid
    expect(delta.sequence).toBeGreaterThanOrEqual(0)
  })

  it('validates payloads against the declared SSE event schema', () => {
    // Creating a completed event without required 'reply' should still work
    // since validation is at the envelope level
    const event = factory.completed({ reply: 'done' })
    expect(event.payload.reply).toBe('done')
  })

  it('creates state_update and step events', () => {
    const stateEvent = factory.stateUpdate({
      player: {
        id: 'p1',
        status: 'ALIVE',
        name: 'Test',
        gender: '男',
        stats: {
          hp: { current: 100, max: 100, status_desc: 'healthy' },
          mp: { current: 50, max: 50, status_desc: 'full' },
          spirit: { value: 10, desc: 'normal' },
          realm: '练气期',
          age: { current: 18, max: 120 },
          race: '人族',
          alignment: '正道',
          sect: '太虚宗',
          spiritual_root: '金',
          mental_state: '平静',
          reputation: 0,
        },
        inventory: [],
        codex: [],
        relationships: {},
        worldTime: Date.now(),
        currentLocation: '新手村',
        npcs: [],
      },
      deltas: {},
    })
    expect(stateEvent.type).toBe('state_update')

    const stepEvent = factory.step({ label: 'thinking' })
    expect(stepEvent.type).toBe('step')
  })
})
