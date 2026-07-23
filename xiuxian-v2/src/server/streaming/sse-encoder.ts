/**
 * SSE encoder — converts domain events to text/event-stream format.
 *
 * Each event is encoded as:
 *   event: <type>    (omitted for "message" type)
 *   data: <json>     (one line per payload line)
 *   <blank line>     (double newline terminates)
 */
export interface SSEEncoder {
  /** Encode an event to a text/event-stream string */
  encode(event: DomainEvent): string
  /** Encode an event to a Uint8Array for stream writing */
  encodeBytes(event: DomainEvent): Uint8Array
}

export interface DomainEvent {
  type: string
  payload: Record<string, unknown>
}

export function createSSEEncoder(): SSEEncoder {
  return {
    encode(event: DomainEvent): string {
      const payload = JSON.stringify(event.payload)
      const lines: string[] = []

      // SSE event type line (omitted for default "message" type)
      if (event.type && event.type !== 'message') {
        lines.push(`event: ${event.type}`)
      }

      // Multi-line data: prepend "data: " to each line of the payload
      for (const line of payload.split('\n')) {
        lines.push(`data: ${line}`)
      }

      // Terminate with double newline
      lines.push('')
      lines.push('')

      return lines.join('\n')
    },

    encodeBytes(event: DomainEvent): Uint8Array {
      return new TextEncoder().encode(this.encode(event))
    },
  }
}
