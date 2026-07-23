/**
 * Event factory — creates versioned SSE envelope events with
 * contiguous sequence numbers, auto-timestamping, and terminal enforcement.
 */
import { PROTOCOL_VERSION, SSEEventTypes } from '../contracts/sse-events'
import type { ProblemDetails } from '../contracts/problem-details'
import type { PlayerSnapshot } from '../contracts/player'
import { createSequenceAllocator, type SequenceAllocator } from './sequence'
import { createTerminalGuard, type TerminalGuard } from './terminal-guard'

export interface EnvelopeEvent {
  protocolVersion: string
  requestId: string
  runId: string
  sequence: number
  occurredAt: string
  type: string
  payload: Record<string, unknown>
}

export interface EventFactoryConfig {
  requestId: string
  runId: string
  protocolVersion?: string
}

export interface EventFactory {
  accepted(params: AcceptedParams): EnvelopeEvent
  step(params: StepParams): EnvelopeEvent
  textDelta(params: TextDeltaParams): EnvelopeEvent
  codex(params: CodexParams): EnvelopeEvent
  journal(params: JournalParams): EnvelopeEvent
  stateUpdate(params: StateUpdateParams): EnvelopeEvent
  completed(params: CompletedParams): EnvelopeEvent
  failed(params: ProblemDetails): EnvelopeEvent
  cancelled(params: CancelledParams): EnvelopeEvent
}

export interface AcceptedParams {
  playerId: string
  mode: string
  requestId?: string
  runId?: string
}

export interface StepParams {
  label: string
}

export interface TextDeltaParams {
  content: string
}

export interface CodexParams {
  name: string
  entry_type: string
  description: string
  metadata?: Record<string, unknown>
  timestamp?: number
}

export interface JournalParams {
  title: string
  content: string
  entry_type: string
  timestamp?: number
}

export interface StateUpdateParams {
  player: PlayerSnapshot
  deltas: Record<string, unknown>
}

export interface CompletedParams {
  reply: string
  stats?: Record<string, unknown>
}

export interface CancelledParams {
  reason?: string
}

export function createEventFactory(config: EventFactoryConfig): EventFactory {
  const protocolVersion = config.protocolVersion ?? PROTOCOL_VERSION
  const { requestId, runId } = config
  const seq: SequenceAllocator = createSequenceAllocator()
  const guard: TerminalGuard = createTerminalGuard()

  function makeEvent(type: string, payload: Record<string, unknown>): EnvelopeEvent {
    guard.check(type as typeof SSEEventTypes[keyof typeof SSEEventTypes])
    return {
      protocolVersion,
      requestId,
      runId,
      sequence: seq.next(),
      occurredAt: new Date().toISOString(),
      type,
      payload,
    }
  }

  return {
    accepted(params: AcceptedParams): EnvelopeEvent {
      return makeEvent(SSEEventTypes.ACCEPTED, {
        requestId: params.requestId ?? requestId,
        runId: params.runId ?? runId,
        playerId: params.playerId,
        mode: params.mode,
      })
    },

    step(params: StepParams): EnvelopeEvent {
      return makeEvent(SSEEventTypes.STEP, { label: params.label })
    },

    textDelta(params: TextDeltaParams): EnvelopeEvent {
      return makeEvent(SSEEventTypes.TEXT_DELTA, { content: params.content })
    },

    codex(params: CodexParams): EnvelopeEvent {
      return makeEvent(SSEEventTypes.CODEX, {
        name: params.name,
        entry_type: params.entry_type,
        description: params.description,
        metadata: params.metadata,
        timestamp: params.timestamp ?? Date.now(),
      })
    },

    journal(params: JournalParams): EnvelopeEvent {
      return makeEvent(SSEEventTypes.JOURNAL, {
        title: params.title,
        content: params.content,
        entry_type: params.entry_type,
        timestamp: params.timestamp ?? Date.now(),
      })
    },

    stateUpdate(params: StateUpdateParams): EnvelopeEvent {
      return makeEvent(SSEEventTypes.STATE_UPDATE, {
        player: params.player,
        deltas: params.deltas,
      })
    },

    completed(params: CompletedParams): EnvelopeEvent {
      return makeEvent(SSEEventTypes.COMPLETED, {
        reply: params.reply,
        stats: params.stats,
      })
    },

    failed(params: ProblemDetails): EnvelopeEvent {
      return makeEvent(SSEEventTypes.FAILED, params as unknown as Record<string, unknown>)
    },

    cancelled(params: CancelledParams): EnvelopeEvent {
      return makeEvent(SSEEventTypes.CANCELLED, {
        requestId,
        runId,
        reason: params.reason,
      })
    },
  }
}
