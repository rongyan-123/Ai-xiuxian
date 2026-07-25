/**
 * Contract-derived HTTP client for the API v1 game-action SSE endpoint.
 *
 * Integrates:
 * - POST to `/api/v1/game/action` with JSON body
 * - Incremental SSE parsing via `parseSSEChunk`
 * - Event validation against `SSEEventSchema` (discriminated union)
 * - Stable PROTOCOL_ERROR / STREAM_INTERRUPTED error mapping
 * - AbortController-based cancellation
 *
 * Usage:
 *   const stream = createGameTurnStream({ input, playerId, ... })
 *   for await (const event of stream) { ... }
 *
 *   // or with cancel:
 *   const stream = createGameTurnStream({ ... })
 *   stream.abort()
 */
import { parseSSEChunk } from './sse-parser'
import { SSEEventSchema } from '@/server/contracts/sse-events'
import type { SSEEvent } from '@/server/contracts/sse-events'
import type { ProblemDetails } from '@/server/contracts/problem-details'

// ─── Public Types ───────────────────────────────────────────────────────────

export interface GameTurnRequest {
  input: string
  playerId: string
  /** 'action' | 'prepare' — defaults to 'action' */
  mode?: 'action' | 'prepare' | string
  playerName?: string
  idempotencyKey?: string
}

export interface GameTurnStreamResult {
  /** Async iterator over validated SSE events */
  [Symbol.asyncIterator](): AsyncIterator<SSEEvent>
  /** Abort the underlying request */
  abort(): void
}

export interface GameTurnError {
  code: string
  message: string
  status?: number
  retryable: boolean
  /** Raw Problem Details if the server returned RFC 9457 response */
  problemDetails?: ProblemDetails
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createGameTurnStream(
  request: GameTurnRequest,
  options?: {
    baseUrl?: string
    signal?: AbortSignal
  },
): GameTurnStreamResult {
  const controller = new AbortController()
  const signal = options?.signal ?? controller.signal
  const baseUrl = options?.baseUrl ?? ''

  // Link external signal to our controller
  if (options?.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  const endpoint = `${baseUrl}/api/v1/game/action`

  const body: Record<string, unknown> = {
    input: request.input,
    playerId: request.playerId,
    mode: request.mode ?? 'action',
    playerName: request.playerName ?? '修仙者',
  }
  if (request.idempotencyKey) {
    body.idempotencyKey = request.idempotencyKey
  }

  async function* streamEvents(): AsyncIterator<SSEEvent> {
    let response: Response

    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw createStreamError('STREAM_INTERRUPTED', 'Request was cancelled', true)
      }
      throw createStreamError('STREAM_INTERRUPTED', `Network error: ${(err as Error).message}`, true)
    }

    // Non-200 response — parse Problem Details
    if (!response.ok) {
      let problemDetails: ProblemDetails | undefined
      try {
        problemDetails = (await response.json()) as ProblemDetails
      } catch {
        // Response body was not JSON
      }

      if (problemDetails) {
        throw {
          code: problemDetails.code ?? 'PROTOCOL_ERROR',
          message: problemDetails.detail ?? problemDetails.title ?? `Server returned ${response.status} ${response.statusText}`,
          status: response.status,
          retryable: problemDetails.retryable ?? false,
          problemDetails,
        } satisfies GameTurnError
      }

      throw createStreamError(
        'PROTOCOL_ERROR',
        `Server returned ${response.status} ${response.statusText}`,
        false,
        response.status,
      )
    }

    // 200 OK — read SSE stream
    if (!response.body) {
      throw createStreamError('STREAM_INTERRUPTED', 'Response body is null', false)
    }

    const reader = response.body.getReader()
    let buffer = ''

    try {
      while (true) {
        let result: ReadableStreamReadResult<Uint8Array>

        try {
          result = await reader.read()
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            throw createStreamError('STREAM_INTERRUPTED', 'Stream read cancelled', true)
          }
          throw createStreamError('STREAM_INTERRUPTED', `Stream read error: ${(err as Error).message}`, true)
        }

        if (result.done) {
          // Stream ended — if we have buffered content, it's an interrupted stream
          if (buffer.trim() !== '') {
            throw createStreamError(
              'STREAM_INTERRUPTED',
              'Stream ended with incomplete event data',
              true,
            )
          }
          break
        }

        const { events, buffer: newBuffer } = parseSSEChunk(result.value, buffer)
        buffer = newBuffer

        for (const rawEvent of events) {
          // SSE raw event: { type, data, id, retry }
          // The data field is a JSON string containing the envelope
          let envelope: Record<string, unknown>
          try {
            envelope = JSON.parse(rawEvent.data) as Record<string, unknown>
          } catch {
            // Skip malformed JSON lines
            continue
          }

          // Validate against the discriminated union schema
          const parsed = SSEEventSchema.safeParse(envelope)
          if (!parsed.success) {
            // Malformed event — protocol error
            throw createStreamError(
              'PROTOCOL_ERROR',
              `Invalid SSE event: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
              false,
            )
          }

          yield parsed.data
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  const iterator = streamEvents()

  return {
    [Symbol.asyncIterator](): AsyncIterator<SSEEvent> {
      return iterator
    },
    abort(): void {
      controller.abort()
    },
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function createStreamError(
  code: string,
  message: string,
  retryable: boolean,
  status?: number,
): GameTurnError {
  return { code, message, status, retryable }
}
