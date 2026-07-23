/**
 * Incremental SSE (Server-Sent Events) parser for the game client.
 *
 * Handles:
 * - UTF-8 decoding across chunk boundaries
 * - Split SSE frames (partial lines)
 * - Leading BOM stripping
 * - Multi-line data fields
 * - Event type extraction
 * - JSON parsing with error tolerance
 *
 * This is a pure function — no React, no mutable module state.
 */
export interface SSEEvent {
  type: string
  data: string
  id?: string
  retry?: number
}

export interface ParsedSSE {
  /** Fully parsed events from this chunk */
  events: SSEEvent[]
  /** Remaining partial line buffer to prepend to next chunk */
  buffer: string
}

// ─── Constants ────────────────────────────────────────────────────────────

const BOM = '﻿'
const LINE_BREAK = '\n'
const DOUBLE_BREAK = '\n\n'

// ─── Public API ───────────────────────────────────────────────────────────

const decoder = new TextDecoder()

/**
 * Parse a Uint8Array chunk from an SSE stream.
 *
 * Call this for each chunk received. Pass the `buffer` from the previous
 * call's result. On the first call, pass an empty string.
 *
 * The returned `buffer` should be passed to the next call. This handles
 * partial lines that span chunk boundaries.
 */
export function parseSSEChunk(chunk: Uint8Array, previousBuffer: string): ParsedSSE {
  let text = decoder.decode(chunk, { stream: true })

  // Strip BOM from first chunk
  if (previousBuffer === '' && text.startsWith(BOM)) {
    text = text.slice(1)
  }

  const raw = previousBuffer + text
  const events: SSEEvent[] = []
  let buffer = ''

  // Split on double newlines (SSE event separator)
  const parts = raw.split(DOUBLE_BREAK)

  // The last part may be incomplete
  for (let i = 0; i < parts.length - 1; i++) {
    const event = parseSSEEvent(parts[i])
    if (event) {
      events.push(event)
    }
  }

  buffer = parts[parts.length - 1] ?? ''

  // If the raw text ends with \n\n, the buffer is empty
  if (raw.endsWith(DOUBLE_BREAK) && buffer === '') {
    // Last complete event was processed above
  }

  return { events, buffer }
}

/**
 * Reset the decoder state for a new stream.
 */
export function createSSEParser() {
  let buffer = ''

  return {
    /** Feed a chunk and get parsed events. */
    feed(chunk: Uint8Array): SSEEvent[] {
      const result = parseSSEChunk(chunk, buffer)
      buffer = result.buffer
      return result.events
    },

    /** Get any remaining buffer content. */
    flush(): string {
      const remaining = buffer
      buffer = ''
      return remaining
    },

    /** Reset parser state for reuse. */
    reset(): void {
      buffer = ''
    },
  }
}

// ─── Internal Helpers ────────────────────────────────────────────────────

function parseSSEEvent(raw: string): SSEEvent | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null

  const lines = trimmed.split(LINE_BREAK)
  let eventType = 'message'
  let data = ''
  let id: string | undefined
  let retry: number | undefined

  for (const line of lines) {
    if (line === '' || line.startsWith(':')) {
      // Comment or empty — ignore
      continue
    }

    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) {
      // Field with no value
      const field = line
      if (field === 'data') data += '\n'
      continue
    }

    const field = line.slice(0, colonIndex)
    let value = line.slice(colonIndex + 1)

    // Strip single leading space
    if (value.startsWith(' ')) {
      value = value.slice(1)
    }

    switch (field) {
      case 'event':
        eventType = value
        break
      case 'data':
        data += (data ? '\n' : '') + value
        break
      case 'id':
        id = value
        break
      case 'retry':
        retry = parseInt(value, 10)
        break
    }
  }

  // Return null for events with no meaningful content (all comments/empty lines)
  if (data === '' && eventType === 'message' && id === undefined && retry === undefined) {
    return null
  }

  return { type: eventType, data, id, retry }
}

// ─── JSON Extractor ──────────────────────────────────────────────────────

export interface ParsedSSEEvent<T = unknown> {
  sequence?: number
  type: string
  payload: T
  raw: string
}

/**
 * Parse the JSON payload from SSE data fields and validate structure.
 * Returns null for non-JSON data or invalid event shapes.
 */
export function parseSSEJson<T = Record<string, unknown>>(event: SSEEvent): ParsedSSEEvent<T> | null {
  try {
    const obj = JSON.parse(event.data) as Record<string, unknown>
    const type = (obj.type as string) ?? event.type
    const payload = (obj.payload ?? obj) as T
    return {
      sequence: obj.sequence as number | undefined,
      type,
      payload,
      raw: event.data,
    }
  } catch {
    return null
  }
}
