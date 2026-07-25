/**
 * Pure game-turn reducer for client-side state management.
 *
 * Manages the complete lifecycle:
 *   idle → submitting → streaming → completed | failed | cancelled
 *                       → cancelling → cancelled
 *
 * Key behaviors:
 * - Authoritative/candidate state separation: replyText accumulates during
 *   streaming as "candidate" text; the completed event provides the final
 *   authoritative reply.
 * - Sequence validation: non-terminal events must be strictly contiguous;
 *   gaps before terminal events are allowed but sequence regression triggers
 *   PROTOCOL_ERROR.
 * - Terminal states reject all actions except RESET.
 * - Idempotency key is preserved across the lifecycle and cleared on RESET.
 * - Candidate text after a failed event is preserved for error display
 *   but no longer authoritative.
 */
import type { ParsedSSEEvent } from './sse-parser'

// ─── State ─────────────────────────────────────────────────────────────────

export type GameStatus =
  | 'idle'
  | 'submitting'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'cancelling'
  | 'cancelled'

export interface GameTurnError {
  code: string
  message: string
  retryable: boolean
}

export interface GameTurnState {
  status: GameStatus
  requestId: string | null
  runId: string | null
  idempotencyKey: string | null
  /** Last received sequence number, -1 if no events yet */
  lastSequence: number
  /** Accumulated reply text (candidate during streaming, authoritative on completed) */
  replyText: string
  /** Accumulated step log entries */
  stepLogs: Array<{ label: string }>
  /** Authoritative player state snapshot (set only on completed) */
  authoritativeState: Record<string, unknown> | null
  /** Error info when status is 'failed' */
  error: GameTurnError | null
  /** Reason for cancellation */
  cancelReason: string | null
}

export const initialGameTurnState: GameTurnState = {
  status: 'idle',
  requestId: null,
  runId: null,
  idempotencyKey: null,
  lastSequence: -1,
  replyText: '',
  stepLogs: [],
  authoritativeState: null,
  error: null,
  cancelReason: null,
}

// ─── Actions ────────────────────────────────────────────────────────────────

export interface SubmitAction {
  type: 'SUBMIT'
  playerId: string
  playerName: string
  input: string
  mode: string
  idempotencyKey: string
}

export interface SSEEventAction {
  type: 'SSE_EVENT'
  event: ParsedSSEEvent<Record<string, unknown>>
}

export interface CancelAction {
  type: 'CANCEL'
}

export interface FailAction {
  type: 'FAIL'
  error: GameTurnError
}

export interface ResetAction {
  type: 'RESET'
}

export type GameTurnAction = SubmitAction | SSEEventAction | CancelAction | FailAction | ResetAction

// ─── Terminal Events ────────────────────────────────────────────────────────

const TERMINAL_TYPES = new Set(['completed', 'failed', 'cancelled'])

// ─── Reducer ────────────────────────────────────────────────────────────────

export function gameTurnReducer(state: GameTurnState, action: GameTurnAction): GameTurnState {
  switch (action.type) {
    case 'SUBMIT':
      return handleSubmit(state, action)
    case 'SSE_EVENT':
      return handleSSEEvent(state, action.event)
    case 'CANCEL':
      return handleCancel(state)
    case 'FAIL':
      return handleFail(state, action.error)
    case 'RESET':
      return initialGameTurnState
    default:
      return state
  }
}

// ─── Action Handlers ────────────────────────────────────────────────────────

function handleSubmit(state: GameTurnState, action: SubmitAction): GameTurnState {
  // Terminal states reject submissions
  if (state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') {
    return state
  }

  // Already submitting or cancelling — ignore duplicate
  if (state.status === 'submitting' || state.status === 'cancelling') {
    return state
  }

  return {
    ...initialGameTurnState,
    status: 'submitting',
    idempotencyKey: action.idempotencyKey,
  }
}

function handleCancel(state: GameTurnState): GameTurnState {
  // Can only cancel from submitting or streaming
  if (state.status === 'submitting' || state.status === 'streaming') {
    return {
      ...state,
      status: 'cancelling',
    }
  }

  // Already cancelling, completed, failed, cancelled, or idle — no-op
  return state
}

function handleFail(state: GameTurnState, error: GameTurnError): GameTurnState {
  // Only transition from submitting or streaming to failed
  if (state.status !== 'submitting' && state.status !== 'streaming') {
    return state
  }
  return {
    ...state,
    status: 'failed',
    error,
  }
}

function handleSSEEvent(state: GameTurnState, event: ParsedSSEEvent<Record<string, unknown>>): GameTurnState {
  const { type: eventType } = event
  const sequence = event.sequence ?? -1

  // Terminal states ignore all events
  if (state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') {
    return state
  }

  // Idle state ignores events (no stream active)
  if (state.status === 'idle') {
    return state
  }

  // Handle cancelling state — only terminal events matter
  if (state.status === 'cancelling') {
    if (eventType === 'cancelled') {
      return {
        ...state,
        status: 'cancelled',
        cancelReason: (event.payload as { reason?: string }).reason ?? state.cancelReason,
        lastSequence: sequence >= 0 ? sequence : state.lastSequence,
      }
    }
    // Server sent completed or failed before acknowledging cancel — user intent wins
    if (eventType === 'completed' || eventType === 'failed') {
      return { ...state, status: 'cancelled' }
    }
    // Non-terminal events: stay cancelling, ignore
    return state
  }

  // Submitting state — only accepted, failed, or cancelled are valid first events
  if (state.status === 'submitting') {
    if (eventType === 'accepted') {
      const payload = event.payload as { requestId: string; runId: string; playerId: string; mode: string }
      return {
        ...state,
        status: 'streaming',
        requestId: payload.requestId,
        runId: payload.runId,
        lastSequence: sequence,
      }
    }

    // Direct terminal events (pre-stream failures)
    if (eventType === 'failed') {
      return buildFailedState(state, event, sequence)
    }
    if (eventType === 'cancelled') {
      return buildCancelledState(state, event, sequence)
    }

    // Any other event before accepted is ignored
    return state
  }

  // Streaming state — process events with sequence validation
  if (state.status === 'streaming') {
    // Duplicate accepted event is a protocol error
    if (eventType === 'accepted') {
      return state
    }

    // Validate sequence for all events
    if (sequence >= 0) {
      const seqResult = validateSequence(state.lastSequence, sequence, eventType)
      if (seqResult !== null) {
        return { ...state, status: 'failed', error: seqResult }
      }
    }

    // Process by event type
    switch (eventType) {
      case 'text-delta': {
        const content = (event.payload as { content: string }).content ?? ''
        return {
          ...state,
          replyText: state.replyText + content,
          lastSequence: sequence,
        }
      }

      case 'step': {
        const label = (event.payload as { label: string }).label ?? ''
        return {
          ...state,
          stepLogs: [...state.stepLogs, { label }],
          lastSequence: sequence,
        }
      }

      case 'codex':
      case 'journal':
      case 'state_update':
        // These events are consumed by UI side effects; reducer just tracks sequence
        return { ...state, lastSequence: sequence }

      case 'completed': {
        return {
          ...state,
          status: 'completed',
          lastSequence: sequence,
          authoritativeState: (event.payload as { stats?: Record<string, unknown> }).stats ?? null,
        }
      }

      case 'failed': {
        return buildFailedState(state, event, sequence)
      }

      case 'cancelled': {
        return buildCancelledState(state, event, sequence)
      }

      default:
        return state
    }
  }

  return state
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function validateSequence(
  lastSequence: number,
  current: number,
  eventType: string,
): GameTurnError | null {
  // First event must be sequence 0 (handled in submitting state)
  if (current <= lastSequence) {
    return {
      code: 'PROTOCOL_ERROR',
      message: `Sequence regression: received ${current} after ${lastSequence}`,
      retryable: false,
    }
  }

  // For non-terminal events, enforce strict contiguity
  if (!TERMINAL_TYPES.has(eventType) && current !== lastSequence + 1) {
    return {
      code: 'PROTOCOL_ERROR',
      message: `Sequence gap: expected ${lastSequence + 1}, received ${current}`,
      retryable: false,
    }
  }

  return null
}

function buildFailedState(
  state: GameTurnState,
  event: ParsedSSEEvent<Record<string, unknown>>,
  sequence: number,
): GameTurnState {
  const payload = event.payload as {
    code?: string
    detail?: string
    message?: string
    retryable?: boolean
  }
  return {
    ...state,
    status: 'failed',
    lastSequence: sequence >= 0 ? sequence : state.lastSequence,
    // Preserve candidate replyText for error display context
    error: {
      code: payload.code ?? 'INTERNAL_ERROR',
      message: payload.detail ?? payload.message ?? 'An error occurred',
      retryable: payload.retryable ?? false,
    },
  }
}

function buildCancelledState(
  state: GameTurnState,
  event: ParsedSSEEvent<Record<string, unknown>>,
  sequence: number,
): GameTurnState {
  const payload = event.payload as { reason?: string }
  return {
    ...state,
    status: 'cancelled',
    lastSequence: sequence >= 0 ? sequence : state.lastSequence,
    cancelReason: payload.reason ?? null,
  }
}
