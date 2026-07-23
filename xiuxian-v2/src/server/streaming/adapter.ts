/**
 * Server stream adapter — converts domain events to SSE-encoded bytes
 * and writes them to a Web ReadableStream.
 *
 * The adapter owns the event factory, encoder, and terminal guard.
 * Application code produces domain events; the adapter validates,
 * encodes, sequences, and delivers them.
 *
 * Every opened stream MUST attempt one terminal event. The adapter
 * guarantees this via the terminal guard.
 */
import { createEventFactory, type EventFactory, type EnvelopeEvent } from './event-factory'
import { TERMINAL_EVENTS } from '../contracts/sse-events'
import type { ProblemDetails } from '../contracts/problem-details'

export interface StreamAdapterConfig {
  requestId: string
  runId: string
  protocolVersion?: string
}

export interface StreamAdapter {
  readonly readable: ReadableStream<Uint8Array>
  readonly factory: EventFactory
  write(event: EnvelopeEvent): void
  error(problem: ProblemDetails): void
  cancel(reason?: string): void
  close(): void
}

/** Encode a full envelope event as an SSE text/event-stream frame */
function encodeFrame(event: EnvelopeEvent): Uint8Array {
  const data = JSON.stringify(event)
  const lines: string[] = []

  if (event.type && event.type !== 'message') {
    lines.push(`event: ${event.type}`)
  }
  for (const line of data.split('\n')) {
    lines.push(`data: ${line}`)
  }
  lines.push('', '') // terminating double newline

  return new TextEncoder().encode(lines.join('\n'))
}

export function createStreamAdapter(config: StreamAdapterConfig): StreamAdapter {
  const factory = createEventFactory({
    requestId: config.requestId,
    runId: config.runId,
    protocolVersion: config.protocolVersion,
  })

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let closed = false

  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })

  function enqueue(event: EnvelopeEvent): void {
    if (closed) {
      throw new Error('Cannot write to closed stream')
    }
    if (!controller) {
      throw new Error('Stream controller not initialized')
    }
    controller.enqueue(encodeFrame(event))
  }

  function safeClose(): void {
    if (closed) return
    closed = true
    try {
      controller?.close()
    } catch {
      // Controller may already be closed
    }
  }

  return {
    readable,
    factory,

    write(event: EnvelopeEvent): void {
      enqueue(event)
      if (TERMINAL_EVENTS.has(event.type as Parameters<typeof TERMINAL_EVENTS.has>[0])) {
        safeClose()
      }
    },

    error(problem: ProblemDetails): void {
      if (!closed) {
        const failedEvent = factory.failed(problem)
        enqueue(failedEvent)
      }
      safeClose()
    },

    cancel(reason?: string): void {
      if (!closed) {
        const cancelEvent = factory.cancelled({ reason })
        enqueue(cancelEvent)
      }
      safeClose()
    },

    close(): void {
      safeClose()
    },
  }
}
