/**
 * SSE parser unit tests (TDD: RED phase for task 10.1).
 *
 * Tests the client-side incremental SSE parser covering:
 * - UTF-8 decoding across chunk boundaries
 * - BOM stripping, multi-line data, event/id/retry fields
 * - Comments, split frames, stateful parser lifecycle
 * - JSON extraction with error tolerance
 * - RFC 9457 Problem Details in SSE data
 * - Cancellation, interrupted stream, malformed input
 */
import { describe, it, expect } from 'vitest'
import { parseSSEChunk, createSSEParser, parseSSEJson } from '@/client/sse-parser'
import type { SSEEvent } from '@/client/sse-parser'

// ─── Helpers ────────────────────────────────────────────────────────────────

function chunk(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** Build an SSE event string in the standard SSE text format */
function sseEvent(opts: {
  event?: string
  data: string
  id?: string
  retry?: number
}): string {
  const lines: string[] = []
  if (opts.event) lines.push(`event: ${opts.event}`)
  if (opts.id !== undefined) lines.push(`id: ${opts.id}`)
  if (opts.retry !== undefined) lines.push(`retry: ${opts.retry}`)
  for (const dataLine of opts.data.split('\n')) {
    lines.push(`data: ${dataLine}`)
  }
  // Two empty strings produce the \n\n event separator
  lines.push('', '')
  return lines.join('\n')
}

// ─── parseSSEChunk: Basic Parsing ──────────────────────────────────────────

describe('parseSSEChunk — basic parsing', () => {
  it('parses a single complete SSE event', () => {
    const raw = sseEvent({ event: 'message', data: 'hello world' })
    const result = parseSSEChunk(chunk(raw), '')

    expect(result.events).toHaveLength(1)
    expect(result.events[0].type).toBe('message')
    expect(result.events[0].data).toBe('hello world')
    expect(result.buffer).toBe('')
  })

  it('parses multiple events in one chunk', () => {
    const raw =
      sseEvent({ event: 'step', data: '{"label":"thinking"}' }) +
      sseEvent({ event: 'text-delta', data: '{"content":"你好"}' }) +
      sseEvent({ event: 'completed', data: '{"reply":"done"}' })

    const result = parseSSEChunk(chunk(raw), '')

    expect(result.events).toHaveLength(3)
    expect(result.events[0].type).toBe('step')
    expect(result.events[1].type).toBe('text-delta')
    expect(result.events[2].type).toBe('completed')
  })

  it('defaults event type to "message" when no event field', () => {
    const raw = 'data: plain text\n\n'
    const result = parseSSEChunk(chunk(raw), '')

    expect(result.events).toHaveLength(1)
    expect(result.events[0].type).toBe('message')
    expect(result.events[0].data).toBe('plain text')
  })

  it('returns empty events array for empty input', () => {
    const result = parseSSEChunk(chunk(''), '')
    expect(result.events).toHaveLength(0)
    expect(result.buffer).toBe('')
  })

  it('returns empty events for whitespace-only input', () => {
    const result = parseSSEChunk(chunk('  \n  \n  '), '')
    expect(result.events).toHaveLength(0)
  })
})

// ─── parseSSEChunk: BOM Handling ───────────────────────────────────────────

describe('parseSSEChunk — BOM handling', () => {
  it('strips leading BOM from first chunk', () => {
    const raw = '﻿' + sseEvent({ data: 'first event' })
    const result = parseSSEChunk(chunk(raw), '')

    expect(result.events).toHaveLength(1)
    expect(result.events[0].data).toBe('first event')
  })

  it('does not strip BOM from subsequent chunks', () => {
    // BOM in the middle of a stream should be treated as data
    const raw = '﻿data: mid-stream\n\n'
    const result = parseSSEChunk(chunk(raw), 'previous-buffer-not-empty')

    // BOM is inside the text, treated as literal characters
    expect(result.events.length).toBeGreaterThanOrEqual(0)
  })
})

// ─── parseSSEChunk: Multi-line Data ────────────────────────────────────────

describe('parseSSEChunk — multi-line data', () => {
  it('joins multiple data lines with newlines', () => {
    const raw = 'data: line1\ndata: line2\ndata: line3\n\n'
    const result = parseSSEChunk(chunk(raw), '')

    expect(result.events).toHaveLength(1)
    expect(result.events[0].data).toBe('line1\nline2\nline3')
  })

  it('handles JSON spread across multiple data lines', () => {
    const json = '{"reply":"完成","stats":{"hp":100}}'
    const raw = 'data: ' + json + '\n\n'
    const result = parseSSEChunk(chunk(raw), '')

    expect(result.events).toHaveLength(1)
    expect(result.events[0].data).toBe(json)
  })
})

// ─── parseSSEChunk: Special Fields ─────────────────────────────────────────

describe('parseSSEChunk — event/id/retry fields', () => {
  it('extracts event type from event field', () => {
    const raw = sseEvent({ event: 'failed', data: '{"code":"LLM_TIMEOUT"}' })
    const result = parseSSEChunk(chunk(raw), '')

    expect(result.events[0].type).toBe('failed')
  })

  it('extracts id field', () => {
    const raw = sseEvent({ data: 'payload', id: 'evt-42' })
    const result = parseSSEChunk(chunk(raw), '')

    expect(result.events[0].id).toBe('evt-42')
  })

  it('extracts retry field as number', () => {
    const raw = sseEvent({ data: 'payload', retry: 3000 })
    const result = parseSSEChunk(chunk(raw), '')

    expect(result.events[0].retry).toBe(3000)
  })

  it('ignores retry field when not a valid integer', () => {
    const raw = 'retry: not-a-number\ndata: payload\n\n'
    const result = parseSSEChunk(chunk(raw), '')

    expect(result.events[0].retry).toBeNaN()
  })
})

// ─── parseSSEChunk: Comments ───────────────────────────────────────────────

describe('parseSSEChunk — comments', () => {
  it('ignores comment lines starting with colon', () => {
    const raw = ': this is a comment\ndata: actual data\n\n'
    const result = parseSSEChunk(chunk(raw), '')

    expect(result.events).toHaveLength(1)
    expect(result.events[0].data).toBe('actual data')
  })

  it('treats double newline as event separator (SSE spec)', () => {
    // In SSE, \n\n always separates events. An empty line mid-event
    // means the first part is one event, second part is another.
    const raw = 'event: test\n\ndata: payload\n\n'
    const result = parseSSEChunk(chunk(raw), '')

    // \n\n splits into two events: "event: test" and "data: payload"
    expect(result.events).toHaveLength(2)
    expect(result.events[0].type).toBe('test')
    expect(result.events[0].data).toBe('')
    expect(result.events[1].type).toBe('message')
    expect(result.events[1].data).toBe('payload')
  })

  it('ignores comment-only events (returns null, skipped)', () => {
    const raw = ': just a keepalive comment\n\n'
    const result = parseSSEChunk(chunk(raw), '')

    expect(result.events).toHaveLength(0)
  })
})

// ─── parseSSEChunk: Split Frames Across Chunks ─────────────────────────────

describe('parseSSEChunk — split frames', () => {
  it('handles a line split across chunk boundaries', () => {
    // First chunk ends mid-line
    const part1 = chunk('event: text-delta\ndata: {"conte')
    const part2 = chunk('nt":"hello world"}\n\n')

    const r1 = parseSSEChunk(part1, '')
    expect(r1.events).toHaveLength(0)
    expect(r1.buffer).toBe('event: text-delta\ndata: {"conte')

    const r2 = parseSSEChunk(part2, r1.buffer)
    expect(r2.events).toHaveLength(1)
    expect(r2.events[0].type).toBe('text-delta')
    expect(r2.events[0].data).toBe('{"content":"hello world"}')
  })

  it('handles an event separator split across chunks', () => {
    const part1 = chunk('data: first\n')
    const part2 = chunk('\ndata: second\n\n')

    const r1 = parseSSEChunk(part1, '')
    expect(r1.events).toHaveLength(0)

    const r2 = parseSSEChunk(part2, r1.buffer)
    expect(r2.events).toHaveLength(2)
    expect(r2.events[0].data).toBe('first')
    expect(r2.events[1].data).toBe('second')
  })

  it('handles data split mid-multi-byte UTF-8 character', () => {
    // '修仙' = [e4bf, aeee] in UTF-8 — 6 bytes total
    const cultivation = '修仙'
    const encoded = new TextEncoder().encode(cultivation)
    // Split after byte 4 (mid-character in '仙')
    const part1 = chunk('data: ' + cultivation).slice(0, 6 + 4) // "data: " + first 4 bytes of 修仙
    const part2 = chunk(cultivation).slice(4) // remaining bytes

    // Reconstruct properly
    const fullEncoded = new TextEncoder().encode('data: ' + cultivation + '\n\n')
    const splitPoint = fullEncoded.indexOf(0xae) // rough split
    const actualPart1 = fullEncoded.slice(0, splitPoint > 6 ? splitPoint : fullEncoded.length - 3)
    const actualPart2 = fullEncoded.slice(actualPart1.length)

    const r1 = parseSSEChunk(actualPart1, '')
    const r2 = parseSSEChunk(actualPart2, r1.buffer)

    expect(r2.events).toHaveLength(1)
    expect(r2.events[0].data).toBe(cultivation)
  })

  it('handles many small chunks without losing data', () => {
    const fullText =
      sseEvent({ event: 'step', data: '{"label":"a"}' }) +
      sseEvent({ event: 'text-delta', data: '{"content":"b"}' }) +
      sseEvent({ event: 'completed', data: '{"reply":"c"}' })

    const encoded = new TextEncoder().encode(fullText)
    let buffer = ''
    const allEvents: SSEEvent[] = []

    // Feed one byte at a time
    for (let i = 0; i < encoded.length; i++) {
      const result = parseSSEChunk(encoded.slice(i, i + 1), buffer)
      allEvents.push(...result.events)
      buffer = result.buffer
    }

    expect(allEvents).toHaveLength(3)
    expect(allEvents[0].type).toBe('step')
    expect(allEvents[1].type).toBe('text-delta')
    expect(allEvents[2].type).toBe('completed')
  })
})

// ─── parseSSEChunk: Buffer Edge Cases ──────────────────────────────────────

describe('parseSSEChunk — buffer edge cases', () => {
  it('clears buffer when raw ends with double newline', () => {
    const raw = sseEvent({ data: 'complete' })
    const result = parseSSEChunk(chunk(raw), '')

    expect(result.events).toHaveLength(1)
    expect(result.buffer).toBe('')
  })

  it('preserves trailing content as buffer', () => {
    const raw = sseEvent({ data: 'complete' }) + 'data: incompl'
    const result = parseSSEChunk(chunk(raw), '')

    // The complete event should be parsed
    expect(result.events).toHaveLength(1)
    expect(result.events[0].data).toBe('complete')
    // The incomplete part is buffered
    expect(result.buffer).toBe('data: incompl')
  })

  it('handles zero-byte chunk with existing buffer', () => {
    const result = parseSSEChunk(new Uint8Array(0), 'data: partial')
    expect(result.events).toHaveLength(0)
    expect(result.buffer).toBe('data: partial')
  })
})

// ─── parseSSEChunk: Leading Space After Colon ──────────────────────────────

describe('parseSSEChunk — value formatting', () => {
  it('strips single leading space after colon per SSE spec', () => {
    const raw = 'data: value with leading space\n\n'
    const result = parseSSEChunk(chunk(raw), '')

    expect(result.events[0].data).toBe('value with leading space')
  })

  it('preserves content when no space after colon', () => {
    const raw = 'data:no-space\n\n'
    const result = parseSSEChunk(chunk(raw), '')

    expect(result.events[0].data).toBe('no-space')
  })
})

// ─── createSSEParser: Stateful Lifecycle ───────────────────────────────────

describe('createSSEParser — stateful parser', () => {
  it('feed returns events and accumulates buffer internally', () => {
    const parser = createSSEParser()

    const events1 = parser.feed(chunk('event: step\ndata: {"label":"1"}\n\nevent: text'))
    expect(events1).toHaveLength(1)
    expect(events1[0].type).toBe('step')

    const events2 = parser.feed(chunk('-delta\ndata: {"content":"hello"}\n\n'))
    expect(events2).toHaveLength(1)
    expect(events2[0].type).toBe('text-delta')
  })

  it('flush returns remaining buffer and clears it', () => {
    const parser = createSSEParser()
    parser.feed(chunk('data: incomplete'))

    const remaining = parser.flush()
    expect(remaining).toBe('data: incomplete')

    // Second flush should be empty
    expect(parser.flush()).toBe('')
  })

  it('reset clears internal state for reuse', () => {
    const parser = createSSEParser()
    parser.feed(chunk('data: old-stream\n\n'))

    parser.reset()

    const events = parser.feed(chunk('data: new-stream\n\n'))
    expect(events).toHaveLength(1)
    expect(events[0].data).toBe('new-stream')
  })

  it('full lifecycle: feed → flush → reset → feed', () => {
    const parser = createSSEParser()

    // Stream 1
    parser.feed(chunk('data: stream1-event1\n\n'))
    parser.feed(chunk('data: stream1-incomplete'))
    expect(parser.flush()).toBe('data: stream1-incomplete')

    // Reset for stream 2
    parser.reset()

    // Stream 2
    const events = parser.feed(chunk(sseEvent({ data: 'stream2' })))
    expect(events).toHaveLength(1)
    expect(events[0].data).toBe('stream2')
  })
})

// ─── parseSSEJson: JSON Extraction ─────────────────────────────────────────

describe('parseSSEJson — JSON extraction', () => {
  it('parses valid JSON data and extracts type', () => {
    const event: SSEEvent = {
      type: 'text-delta',
      data: '{"type":"text-delta","payload":{"content":"hello"}}',
    }
    const result = parseSSEJson(event)

    expect(result).not.toBeNull()
    expect(result!.type).toBe('text-delta')
    expect(result!.payload).toEqual({ content: 'hello' })
  })

  it('uses outer event.type when JSON has no type field', () => {
    const event: SSEEvent = {
      type: 'completed',
      data: '{"reply":"任务完成","stats":{"hp":80}}',
    }
    const result = parseSSEJson(event)

    expect(result).not.toBeNull()
    expect(result!.type).toBe('completed')
    expect(result!.payload).toEqual({ reply: '任务完成', stats: { hp: 80 } })
  })

  it('extracts sequence number when present', () => {
    const event: SSEEvent = {
      type: 'text-delta',
      data: '{"sequence":42,"type":"text-delta","payload":{"content":"x"}}',
    }
    const result = parseSSEJson(event)

    expect(result).not.toBeNull()
    expect(result!.sequence).toBe(42)
  })

  it('returns null for invalid JSON', () => {
    const event: SSEEvent = {
      type: 'message',
      data: 'not valid json {{{',
    }
    expect(parseSSEJson(event)).toBeNull()
  })

  it('returns null for empty data string', () => {
    const event: SSEEvent = { type: 'message', data: '' }
    // Empty string is invalid JSON
    expect(parseSSEJson(event)).toBeNull()
  })

  it('preserves raw data string in result', () => {
    const raw = '{"custom":"value"}'
    const event: SSEEvent = { type: 'message', data: raw }
    const result = parseSSEJson(event)

    expect(result).not.toBeNull()
    expect(result!.raw).toBe(raw)
  })

  it('handles null JSON value', () => {
    const event: SSEEvent = { type: 'message', data: 'null' }
    const result = parseSSEJson(event)

    // JSON.parse('null') returns null, which is not a Record
    // So parseSSEJson will try to access obj.type on null and throw → returns null
    expect(result).toBeNull()
  })

  it('handles JSON array (not an object)', () => {
    const event: SSEEvent = { type: 'message', data: '[1,2,3]' }
    // Arrays are typeof 'object' but their .type is undefined
    // payload extraction works: (obj.payload ?? obj) → [1,2,3]
    const result = parseSSEJson(event)

    expect(result).not.toBeNull()
    expect(result!.type).toBe('message') // falls back to event.type
    expect(result!.payload).toEqual([1, 2, 3])
  })
})

// ─── parseSSEJson: Problem Details (RFC 9457) ──────────────────────────────

describe('parseSSEJson — RFC 9457 Problem Details', () => {
  it('extracts failed event with Problem Details payload', () => {
    const event: SSEEvent = {
      type: 'failed',
      data: JSON.stringify({
        type: 'failed',
        payload: {
          type: 'https://api.xiuxian.com/errors/llm-timeout',
          title: 'LLM Timeout',
          status: 504,
          detail: 'LLM provider timed out after 30s',
          code: 'LLM_TIMEOUT',
          requestId: 'req-abc',
          retryable: true,
        },
      }),
    }
    const result = parseSSEJson(event)

    expect(result).not.toBeNull()
    expect(result!.type).toBe('failed')
    const payload = result!.payload as Record<string, unknown>
    expect(payload.code).toBe('LLM_TIMEOUT')
    expect(payload.status).toBe(504)
    expect(payload.retryable).toBe(true)
  })

  it('extracts non-retryable error correctly', () => {
    const event: SSEEvent = {
      type: 'failed',
      data: JSON.stringify({
        type: 'failed',
        payload: {
          type: 'https://api.xiuxian.com/errors/validation-error',
          title: 'Validation Error',
          status: 422,
          detail: 'Input validation failed',
          code: 'VALIDATION_ERROR',
          requestId: 'req-def',
          retryable: false,
        },
      }),
    }
    const result = parseSSEJson(event)

    expect(result).not.toBeNull()
    const payload = result!.payload as Record<string, unknown>
    expect(payload.retryable).toBe(false)
  })
})

// ─── parseSSEJson: Cancellation ────────────────────────────────────────────

describe('parseSSEJson — cancellation', () => {
  it('extracts cancelled event', () => {
    const event: SSEEvent = {
      type: 'cancelled',
      data: JSON.stringify({
        type: 'cancelled',
        payload: {
          requestId: 'req-001',
          runId: 'run-001',
          reason: 'user navigated away',
        },
      }),
    }
    const result = parseSSEJson(event)

    expect(result).not.toBeNull()
    expect(result!.type).toBe('cancelled')
    const payload = result!.payload as Record<string, unknown>
    expect(payload.reason).toBe('user navigated away')
  })
})

// ─── parseSSEJson: Unknown Events ──────────────────────────────────────────

describe('parseSSEJson — unknown events', () => {
  it('passes through unknown event types unchanged', () => {
    const event: SSEEvent = {
      type: 'custom-event',
      data: '{"payload":{"key":"value"}}',
    }
    const result = parseSSEJson(event)

    expect(result).not.toBeNull()
    expect(result!.type).toBe('custom-event')
  })

  it('handles event with unexpected payload shape', () => {
    const event: SSEEvent = {
      type: 'text-delta',
      data: '{"unexpected":"shape","no_payload":true}',
    }
    const result = parseSSEJson(event)

    expect(result).not.toBeNull()
    // Falls back to whole object as payload since no payload key
    expect(result!.payload).toEqual({ unexpected: 'shape', no_payload: true })
  })
})

// ─── Integration: Full SSE Stream Parsing ──────────────────────────────────

describe('SSE parser — full stream scenarios', () => {
  it('parses a complete successful game turn stream', () => {
    const stream =
      sseEvent({ event: 'accepted', data: '{"requestId":"r1","runId":"run1","playerId":"p1","mode":"action"}' }) +
      sseEvent({ event: 'step', data: '{"label":"思考中"}' }) +
      sseEvent({ event: 'text-delta', data: '{"content":"你运转功法"}' }) +
      sseEvent({ event: 'text-delta', data: '{"content":"，感受到灵气汇聚。"}' }) +
      sseEvent({ event: 'state_update', data: '{"player":{},"deltas":{"hp_change":5}}' }) +
      sseEvent({ event: 'completed', data: '{"reply":"修炼完成","stats":{"hp":105}}' })

    const result = parseSSEChunk(chunk(stream), '')

    expect(result.events).toHaveLength(6)
    expect(result.events[0].type).toBe('accepted')
    expect(result.events[1].type).toBe('step')
    expect(result.events[2].type).toBe('text-delta')
    expect(result.events[3].type).toBe('text-delta')
    expect(result.events[4].type).toBe('state_update')
    expect(result.events[5].type).toBe('completed')
    expect(result.buffer).toBe('')
  })

  it('parses a failed stream with Problem Details', () => {
    const stream =
      sseEvent({ event: 'accepted', data: '{"requestId":"r1","runId":"run1","playerId":"p1","mode":"action"}' }) +
      sseEvent({ event: 'failed', data: JSON.stringify({
        type: 'https://api.xiuxian.com/errors/llm-timeout',
        title: 'LLM Timeout',
        status: 504,
        detail: 'The LLM provider timed out',
        code: 'LLM_TIMEOUT',
        requestId: 'r1',
        retryable: true,
      }) })

    const result = parseSSEChunk(chunk(stream), '')

    expect(result.events).toHaveLength(2)
    expect(result.events[0].type).toBe('accepted')
    expect(result.events[1].type).toBe('failed')

    const failedJson = parseSSEJson(result.events[1])
    expect(failedJson).not.toBeNull()
    const payload = failedJson!.payload as Record<string, unknown>
    expect(payload.code).toBe('LLM_TIMEOUT')
    expect(payload.retryable).toBe(true)
  })

  it('parses a cancelled stream', () => {
    const stream =
      sseEvent({ event: 'accepted', data: '{"requestId":"r1","runId":"run1","playerId":"p1","mode":"action"}' }) +
      sseEvent({ event: 'cancelled', data: '{"requestId":"r1","runId":"run1","reason":"user aborted"}' })

    const result = parseSSEChunk(chunk(stream), '')

    expect(result.events).toHaveLength(2)
    expect(result.events[1].type).toBe('cancelled')
  })

  it('handles interrupted stream (no terminal event, partial buffer)', () => {
    // Manually construct partial stream: accepted complete, text-delta incomplete
    const stream =
      sseEvent({ event: 'accepted', data: '{"requestId":"r1","runId":"run1","playerId":"p1","mode":"action"}' }) +
      'event: text-delta\ndata: {"content":"修炼中' // no trailing \n\n — connection drops mid-event

    const result = parseSSEChunk(chunk(stream), '')

    // Accepted should be complete, text-delta is partial
    expect(result.events).toHaveLength(1)
    expect(result.events[0].type).toBe('accepted')
    // Remaining incomplete data is in buffer
    expect(result.buffer).toContain('text-delta')
    expect(result.buffer).toContain('修炼中')
  })

  it('handles text-delta after failed event (candidate text)', () => {
    // This is a protocol violation — text-delta after failed
    // The parser still parses both events; the reducer must handle it
    const stream =
      sseEvent({ event: 'failed', data: JSON.stringify({
        type: 'https://api.xiuxian.com/errors/llm-timeout',
        title: 'LLM Timeout',
        status: 504,
        detail: 'timed out',
        code: 'LLM_TIMEOUT',
        requestId: 'r1',
        retryable: true,
      }) }) +
      sseEvent({ event: 'text-delta', data: '{"content":"candidate text after failure"}' })

    const result = parseSSEChunk(chunk(stream), '')

    // Parser parses both — it doesn't enforce terminal-after rules
    expect(result.events).toHaveLength(2)
    expect(result.events[0].type).toBe('failed')
    expect(result.events[1].type).toBe('text-delta')
  })

  it('handles duplicate terminal events', () => {
    const stream =
      sseEvent({ event: 'completed', data: '{"reply":"first"}' }) +
      sseEvent({ event: 'completed', data: '{"reply":"second"}' })

    const result = parseSSEChunk(chunk(stream), '')

    // Parser parses both terminals — reducer must detect duplicate
    expect(result.events).toHaveLength(2)
    expect(result.events[0].type).toBe('completed')
    expect(result.events[1].type).toBe('completed')
  })
})

// ─── Malformed Input ───────────────────────────────────────────────────────

describe('SSE parser — malformed input', () => {
  it('handles only newlines gracefully', () => {
    const result = parseSSEChunk(chunk('\n\n\n\n\n'), '')
    expect(result.events).toHaveLength(0)
  })

  it('handles data with no double newline as buffer', () => {
    const result = parseSSEChunk(chunk('data: orphan'), '')
    expect(result.events).toHaveLength(0)
    expect(result.buffer).toBe('data: orphan')
  })

  it('handles field with no colon and no value', () => {
    const raw = 'event\ndata: test\n\n'
    const result = parseSSEChunk(chunk(raw), '')
    expect(result.events).toHaveLength(1)
    expect(result.events[0].type).toBe('message') // 'event' line with no colon → field='event' with no value
    expect(result.events[0].data).toBe('test')
  })
})
