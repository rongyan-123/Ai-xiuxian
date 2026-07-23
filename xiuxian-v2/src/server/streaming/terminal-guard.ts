/**
 * Terminal guard — ensures exactly one terminal event per stream.
 * Rejects writes after a terminal event has been emitted.
 */
import { TERMINAL_EVENTS, type SSEEventType } from '../contracts/sse-events'

export interface TerminalGuard {
  check(type: SSEEventType): void
  isTerminated(): boolean
}

export function createTerminalGuard(): TerminalGuard {
  let terminated = false

  return {
    check(type: SSEEventType): void {
      if (terminated) {
        throw new Error(`Cannot emit event "${type}" after terminal event`)
      }
      if (TERMINAL_EVENTS.has(type)) {
        terminated = true
      }
    },
    isTerminated(): boolean {
      return terminated
    },
  }
}
