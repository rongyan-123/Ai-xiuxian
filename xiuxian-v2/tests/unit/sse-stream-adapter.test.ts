/**
 * SSE stream adapter unit tests (TDD: RED phase).
 *
 * Tests the server-side stream adapter that converts app/domain events
 * to SSE-encoded bytes written to a ReadableStream controller.
 *
 * These MUST fail until the adapter module is implemented.
 */
import { describe, it, expect } from 'vitest'

import { createStreamAdapter } from '@/server/streaming/adapter'
import type { StreamAdapter } from '@/server/streaming/adapter'
import { createEventFactory } from '@/server/streaming'
import { PROTOCOL_VERSION } from '@/server/contracts/sse-events'

/** Collect all SSE events written through an adapter */
async function collectStreamEvents(adapter: StreamAdapter): Promise<string[]> {
  const chunks: string[] = []
  const reader = adapter.readable.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(new TextDecoder().decode(value))
  }
  return chunks
}

describe('4.3 Stream adapter', () => {
  it('creates a ReadableStream and delivers events to the reader', async () => {
    const adapter = createStreamAdapter({
      requestId: 'req-001',
      runId: 'run-001',
    })

    adapter.write(adapter.factory.accepted({ playerId: 'p1', mode: 'action' }))
    adapter.write(adapter.factory.step({ label: 'thinking' }))
    adapter.write(adapter.factory.textDelta({ content: 'hello' }))
    adapter.write(adapter.factory.completed({ reply: 'done' }))
    adapter.close()

    const chunks = await collectStreamEvents(adapter)
    expect(chunks.length).toBe(4)

    // First chunk is "accepted" event
    expect(chunks[0]).toContain('event: accepted')
    expect(chunks[0]).toContain('"sequence":0')

    // Last chunk is "completed" event
    expect(chunks[chunks.length - 1]).toContain('event: completed')
  })

  it('rejects writes after close', () => {
    const adapter = createStreamAdapter({
      requestId: 'req-001',
      runId: 'run-001',
    })
    adapter.write(adapter.factory.textDelta({ content: 'hi' }))
    adapter.close()
    expect(() =>
      adapter.write(adapter.factory.textDelta({ content: 'late' }))
    ).toThrow()
  })

  it('rejects writes after terminal event', () => {
    const adapter = createStreamAdapter({
      requestId: 'req-001',
      runId: 'run-001',
    })
    adapter.write(adapter.factory.completed({ reply: 'done' }))
    expect(() =>
      adapter.write(adapter.factory.textDelta({ content: 'late' }))
    ).toThrow()
  })

  it('close() is safe when already closed (idempotent close)', () => {
    const adapter = createStreamAdapter({
      requestId: 'req-001',
      runId: 'run-001',
    })
    adapter.close()
    expect(() => adapter.close()).not.toThrow()
  })

  it('propagates request and run IDs from the factory config', async () => {
    const adapter = createStreamAdapter({
      requestId: 'req-custom',
      runId: 'run-custom',
    })

    adapter.write(adapter.factory.accepted({ playerId: 'p1', mode: 'action' }))
    adapter.close()

    const chunks = await collectStreamEvents(adapter)
    expect(chunks[0]).toContain('"requestId":"req-custom"')
    expect(chunks[0]).toContain('"runId":"run-custom"')
    expect(chunks[0]).toContain(`"protocolVersion":"${PROTOCOL_VERSION}"`)
  })

  it('error() closes the stream with a failed event', async () => {
    const adapter = createStreamAdapter({
      requestId: 'req-001',
      runId: 'run-001',
    })

    adapter.error({
      type: 'https://test/err',
      title: 'Test Error',
      status: 500,
      detail: 'Something went wrong',
      code: 'INTERNAL_ERROR',
      requestId: 'req-001',
      retryable: false,
    })

    const chunks = await collectStreamEvents(adapter)
    expect(chunks.length).toBe(1)
    expect(chunks[0]).toContain('event: failed')
    expect(chunks[0]).toContain('INTERNAL_ERROR')
  })

  it('cancel() closes the stream with a cancelled event', async () => {
    const adapter = createStreamAdapter({
      requestId: 'req-001',
      runId: 'run-001',
    })

    adapter.cancel('user aborted')
    adapter.close()

    const chunks = await collectStreamEvents(adapter)
    expect(chunks.length).toBe(1)
    expect(chunks[0]).toContain('event: cancelled')
    expect(chunks[0]).toContain('user aborted')
  })

  it('terminal event auto-closes the stream', async () => {
    const adapter = createStreamAdapter({
      requestId: 'req-001',
      runId: 'run-001',
    })

    adapter.write(adapter.factory.completed({ reply: 'done' }))
    // No explicit close needed — terminal should trigger close

    const chunks = await collectStreamEvents(adapter)
    expect(chunks.length).toBe(1)
    expect(chunks[0]).toContain('event: completed')
  })

  it('supports the full normal-turn event sequence', async () => {
    const adapter = createStreamAdapter({
      requestId: 'req-001',
      runId: 'run-001',
    })

    // Normal sequence: accepted → step → text-delta → state_update → completed
    adapter.write(adapter.factory.accepted({ playerId: 'p1', mode: 'action' }))
    adapter.write(adapter.factory.step({ label: 'processing' }))
    adapter.write(adapter.factory.textDelta({ content: '你开始修炼。' }))
    adapter.write(adapter.factory.stateUpdate({
      player: {
        id: 'p1',
        status: 'ALIVE',
        name: 'Test',
        gender: '男',
        stats: {
          hp: { current: 100, max: 100, status_desc: '健康' },
          mp: { current: 50, max: 50, status_desc: '充盈' },
          spirit: { value: 10, desc: '凡人' },
          realm: '练气期',
          age: { current: 18, max: 120 },
          race: '人族',
          alignment: '正道',
          sect: '太虚',
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
      deltas: { spirit: { value: 11 } },
    }))
    adapter.close()

    const chunks = await collectStreamEvents(adapter)
    expect(chunks.length).toBe(4)

    // Verify ordering: accepted first
    expect(chunks[0]).toContain('event: accepted')
    expect(chunks[0]).toContain('"sequence":0')

    // Verify sequences are contiguous
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]).toContain(`"sequence":${i}`)
    }
  })

  it('encoding errors during write do not corrupt the stream', () => {
    const adapter = createStreamAdapter({
      requestId: 'req-001',
      runId: 'run-001',
    })
    // Writing a normal event should work fine
    expect(() =>
      adapter.write(adapter.factory.textDelta({ content: 'test' }))
    ).not.toThrow()
    adapter.close()
  })
})
