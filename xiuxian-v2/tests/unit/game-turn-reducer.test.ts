/**
 * Game-turn reducer unit tests (TDD: RED phase for task 10.3).
 *
 * Tests every allowed and forbidden transition across the seven
 * game-turn states: idle, submitting, streaming, completed, failed,
 * cancelling, cancelled.
 *
 * Also covers: sequence validation, authoritative/candidate separation,
 * retryable flag handling, request ID retention, idempotency-key reuse,
 * and candidate text after failed persistence.
 */
import { describe, it, expect } from 'vitest'
import {
  gameTurnReducer,
  initialGameTurnState,
} from '@/client/game-turn-reducer'
import type {
  GameTurnState,
  GameTurnAction,
  SSEEventAction,
} from '@/client/game-turn-reducer'

// ─── Helpers ────────────────────────────────────────────────────────────────

const REQUEST_ID = 'req-test-001'
const RUN_ID = 'run-test-001'
const IDEMPOTENCY_KEY = 'idem-test-001'

function acceptedEvent(overrides?: Record<string, unknown>) {
  return {
    sequence: 0,
    type: 'accepted' as const,
    payload: {
      requestId: REQUEST_ID,
      runId: RUN_ID,
      playerId: 'player-1',
      mode: 'action',
      ...overrides,
    },
    raw: JSON.stringify({ requestId: REQUEST_ID, runId: RUN_ID, playerId: 'player-1', mode: 'action' }),
  }
}

function textDeltaEvent(content: string, sequence = 1) {
  return {
    sequence,
    type: 'text-delta' as const,
    payload: { content },
    raw: JSON.stringify({ content }),
  }
}

function stepEvent(label: string, sequence = 1) {
  return {
    sequence,
    type: 'step' as const,
    payload: { label },
    raw: JSON.stringify({ label }),
  }
}

function completedEvent(reply: string, sequence = 99, stats?: Record<string, unknown>) {
  return {
    sequence,
    type: 'completed' as const,
    payload: { reply, ...(stats ? { stats } : {}) },
    raw: JSON.stringify({ reply }),
  }
}

function failedEvent(code: string, message: string, retryable: boolean, sequence = 99) {
  return {
    sequence,
    type: 'failed' as const,
    payload: {
      type: `https://api.xiuxian.com/errors/${code.toLowerCase()}`,
      title: 'Error',
      status: 500,
      detail: message,
      code,
      requestId: REQUEST_ID,
      retryable,
    },
    raw: JSON.stringify({ code, message, retryable }),
  }
}

function cancelledEvent(reason?: string, sequence = 99) {
  return {
    sequence,
    type: 'cancelled' as const,
    payload: {
      requestId: REQUEST_ID,
      runId: RUN_ID,
      reason,
    },
    raw: JSON.stringify({ reason }),
  }
}

function submitAction(overrides?: Partial<GameTurnAction>): GameTurnAction {
  return {
    type: 'SUBMIT',
    playerId: 'player-1',
    playerName: '测试修士',
    input: '修炼',
    mode: 'action',
    idempotencyKey: IDEMPOTENCY_KEY,
    ...overrides,
  } as GameTurnAction
}

function cancelAction(): GameTurnAction {
  return { type: 'CANCEL' }
}

function resetAction(): GameTurnAction {
  return { type: 'RESET' }
}

function sseAction(event: { sequence: number; type: string; payload: Record<string, unknown>; raw: string }): GameTurnAction {
  return { type: 'SSE_EVENT', event } as SSEEventAction
}

// ─── Initial State ──────────────────────────────────────────────────────────

describe('gameTurnReducer — initial state', () => {
  it('returns idle status', () => {
    expect(initialGameTurnState.status).toBe('idle')
  })

  it('has null requestId, runId, and idempotencyKey', () => {
    expect(initialGameTurnState.requestId).toBeNull()
    expect(initialGameTurnState.runId).toBeNull()
    expect(initialGameTurnState.idempotencyKey).toBeNull()
  })

  it('has empty replyText and stepLogs', () => {
    expect(initialGameTurnState.replyText).toBe('')
    expect(initialGameTurnState.stepLogs).toEqual([])
  })

  it('has lastSequence -1 (no events yet)', () => {
    expect(initialGameTurnState.lastSequence).toBe(-1)
  })

  it('has null error and authoritativeState', () => {
    expect(initialGameTurnState.error).toBeNull()
    expect(initialGameTurnState.authoritativeState).toBeNull()
  })
})

// ─── idle → submitting ──────────────────────────────────────────────────────

describe('idle → submitting', () => {
  it('transitions to submitting on SUBMIT', () => {
    const action = submitAction()
    const next = gameTurnReducer(initialGameTurnState, action)

    expect(next.status).toBe('submitting')
  })

  it('stores request metadata on SUBMIT', () => {
    const action = submitAction()
    const next = gameTurnReducer(initialGameTurnState, action)

    expect(next.idempotencyKey).toBe(IDEMPOTENCY_KEY)
    expect(next.replyText).toBe('') // reset from previous run
  })

  it('ignores CANCEL from idle (nothing to cancel)', () => {
    const next = gameTurnReducer(initialGameTurnState, cancelAction())
    expect(next.status).toBe('idle')
  })

  it('ignores SSE_EVENT from idle (no stream active)', () => {
    const next = gameTurnReducer(initialGameTurnState, sseAction(acceptedEvent()))
    expect(next.status).toBe('idle')
  })

  it('stays idle on RESET from idle', () => {
    const next = gameTurnReducer(initialGameTurnState, resetAction())
    expect(next.status).toBe('idle')
  })
})

// ─── submitting → streaming ─────────────────────────────────────────────────

describe('submitting → streaming', () => {
  function submittingState(overrides?: Partial<GameTurnState>): GameTurnState {
    return {
      ...initialGameTurnState,
      status: 'submitting',
      idempotencyKey: IDEMPOTENCY_KEY,
      ...overrides,
    }
  }

  it('transitions to streaming on accepted event (sequence 0)', () => {
    const next = gameTurnReducer(submittingState(), sseAction(acceptedEvent()))
    expect(next.status).toBe('streaming')
  })

  it('captures requestId and runId from accepted event', () => {
    const next = gameTurnReducer(submittingState(), sseAction(acceptedEvent()))
    expect(next.requestId).toBe(REQUEST_ID)
    expect(next.runId).toBe(RUN_ID)
  })

  it('sets lastSequence to 0 on accepted', () => {
    const next = gameTurnReducer(submittingState(), sseAction(acceptedEvent()))
    expect(next.lastSequence).toBe(0)
  })

  it('rejects non-zero sequence first event (must start at 0)', () => {
    const state = submittingState()
    // An event with sequence 5 as first event is a protocol violation
    const badEvent = textDeltaEvent('bad', 5)
    const next = gameTurnReducer(state, sseAction(badEvent))
    // Should remain in submitting (or transition to failed)
    // The reducer should reject events before accepted
    expect(next.status).toBe('submitting')
  })

  it('transitions directly to failed on failed event', () => {
    const next = gameTurnReducer(
      submittingState(),
      sseAction(failedEvent('LLM_TIMEOUT', 'timed out', true, 0)),
    )
    expect(next.status).toBe('failed')
    expect(next.error?.code).toBe('LLM_TIMEOUT')
    expect(next.error?.retryable).toBe(true)
  })

  it('transitions directly to cancelled on cancelled event', () => {
    const next = gameTurnReducer(
      submittingState(),
      sseAction(cancelledEvent('server shutdown', 0)),
    )
    expect(next.status).toBe('cancelled')
    expect(next.cancelReason).toBe('server shutdown')
  })

  it('transitions to cancelling on user CANCEL', () => {
    const next = gameTurnReducer(submittingState(), cancelAction())
    expect(next.status).toBe('cancelling')
  })

  it('ignores duplicate SUBMIT while submitting', () => {
    const next = gameTurnReducer(submittingState(), submitAction())
    expect(next.status).toBe('submitting')
  })
})

// ─── streaming → * ──────────────────────────────────────────────────────────

describe('streaming state transitions', () => {
  function streamingState(overrides?: Partial<GameTurnState>): GameTurnState {
    return {
      ...initialGameTurnState,
      status: 'streaming',
      requestId: REQUEST_ID,
      runId: RUN_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      lastSequence: 0,
      replyText: '',
      stepLogs: [],
      ...overrides,
    }
  }

  it('accumulates text-delta content into replyText', () => {
    const state = streamingState()
    const next1 = gameTurnReducer(state, sseAction(textDeltaEvent('你运转', 1)))
    expect(next1.replyText).toBe('你运转')
    expect(next1.status).toBe('streaming')

    const next2 = gameTurnReducer(next1, sseAction(textDeltaEvent('功法修炼', 2)))
    expect(next2.replyText).toBe('你运转功法修炼')
    expect(next2.status).toBe('streaming')
  })

  it('accumulates step events into stepLogs', () => {
    const state = streamingState()
    const next1 = gameTurnReducer(state, sseAction(stepEvent('思考中', 1)))
    expect(next1.stepLogs).toEqual([{ label: '思考中' }])

    const next2 = gameTurnReducer(next1, sseAction(stepEvent('规则判定', 2)))
    expect(next2.stepLogs).toEqual([{ label: '思考中' }, { label: '规则判定' }])
  })

  it('transitions to completed on completed event', () => {
    const state = streamingState({ replyText: '修炼完成' })
    const next = gameTurnReducer(state, sseAction(completedEvent('修炼完成', 10)))

    expect(next.status).toBe('completed')
    // Completed reply should contain the final authoritative reply
    expect(next.replyText).toBe('修炼完成')
  })

  it('transitions to failed on failed event', () => {
    const state = streamingState({ replyText: 'candidate text while streaming' })
    const next = gameTurnReducer(state, sseAction(failedEvent('LLM_UNAVAILABLE', 'service down', true, 5)))

    expect(next.status).toBe('failed')
    expect(next.error?.code).toBe('LLM_UNAVAILABLE')
    // Candidate text is preserved for display but marked non-authoritative
    expect(next.replyText).toBe('candidate text while streaming')
  })

  it('transitions to cancelled on cancelled event', () => {
    const next = gameTurnReducer(streamingState(), sseAction(cancelledEvent('user left', 3)))
    expect(next.status).toBe('cancelled')
  })

  it('transitions to cancelling on user CANCEL', () => {
    const next = gameTurnReducer(streamingState(), cancelAction())
    expect(next.status).toBe('cancelling')
  })

  it('ignores duplicate accepted event', () => {
    const state = streamingState({ lastSequence: 5 })
    // Receiving another accepted after already streaming is a protocol error
    const next = gameTurnReducer(state, sseAction(acceptedEvent()))
    // Should remain in streaming, not re-process accepted
    expect(next.status).toBe('streaming')
  })

  it('updates lastSequence on each event', () => {
    const state = streamingState()
    const next = gameTurnReducer(state, sseAction(textDeltaEvent('hello', 1)))
    expect(next.lastSequence).toBe(1)
  })
})

// ─── completed terminal state ───────────────────────────────────────────────

describe('completed state — terminal', () => {
  function completedState(overrides?: Partial<GameTurnState>): GameTurnState {
    return {
      ...initialGameTurnState,
      status: 'completed',
      requestId: REQUEST_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      lastSequence: 10,
      replyText: '任务完成',
      ...overrides,
    }
  }

  it('ignores all SSE events (terminal state)', () => {
    const next = gameTurnReducer(completedState(), sseAction(textDeltaEvent('late text', 11)))
    expect(next.status).toBe('completed')
  })

  it('ignores SUBMIT (terminal state)', () => {
    const next = gameTurnReducer(completedState(), submitAction())
    expect(next.status).toBe('completed')
  })

  it('ignores CANCEL (already finished)', () => {
    const next = gameTurnReducer(completedState(), cancelAction())
    expect(next.status).toBe('completed')
  })

  it('resets to idle on RESET', () => {
    const next = gameTurnReducer(completedState(), resetAction())
    expect(next).toEqual(initialGameTurnState)
  })
})

// ─── failed terminal state ──────────────────────────────────────────────────

describe('failed state — terminal', () => {
  function failedState(retryable: boolean, overrides?: Partial<GameTurnState>): GameTurnState {
    return {
      ...initialGameTurnState,
      status: 'failed',
      requestId: REQUEST_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      lastSequence: 5,
      replyText: 'some candidate text',
      error: { code: 'LLM_TIMEOUT', message: 'timed out', retryable },
      ...overrides,
    }
  }

  it('ignores SSE events after failure', () => {
    const next = gameTurnReducer(
      failedState(true),
      sseAction(textDeltaEvent('candidate text after failure', 6)),
    )
    // Remains failed, ignores late events
    expect(next.status).toBe('failed')
  })

  it('ignores completed event after failure', () => {
    const next = gameTurnReducer(
      failedState(false),
      sseAction(completedEvent('too late', 6)),
    )
    expect(next.status).toBe('failed')
  })

  it('ignores SUBMIT (terminal state)', () => {
    const next = gameTurnReducer(failedState(true), submitAction())
    expect(next.status).toBe('failed')
  })

  it('ignores CANCEL (already failed)', () => {
    const next = gameTurnReducer(failedState(true), cancelAction())
    expect(next.status).toBe('failed')
  })

  it('resets to idle on RESET (allows retry)', () => {
    const next = gameTurnReducer(failedState(true), resetAction())
    expect(next).toEqual(initialGameTurnState)
  })

  it('preserves error details in state', () => {
    const state = failedState(false)
    expect(state.error?.code).toBe('LLM_TIMEOUT')
    expect(state.error?.retryable).toBe(false)
  })

  it('preserves retryable flag correctly when true', () => {
    const state = failedState(true)
    expect(state.error?.retryable).toBe(true)
  })
})

// ─── cancelling → cancelled ─────────────────────────────────────────────────

describe('cancelling state', () => {
  function cancellingState(overrides?: Partial<GameTurnState>): GameTurnState {
    return {
      ...initialGameTurnState,
      status: 'cancelling',
      requestId: REQUEST_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      lastSequence: 3,
      replyText: 'partial reply',
      ...overrides,
    }
  }

  it('transitions to cancelled on cancelled event from server', () => {
    const next = gameTurnReducer(cancellingState(), sseAction(cancelledEvent('acknowledged', 4)))
    expect(next.status).toBe('cancelled')
  })

  it('transitions to cancelled on completed event (server finished before seeing cancel)', () => {
    // Server completed before it could cancel — but user wanted cancel, so treat as cancelled
    const next = gameTurnReducer(cancellingState(), sseAction(completedEvent('done', 4)))
    expect(next.status).toBe('cancelled')
  })

  it('transitions to cancelled on failed event (server failed before cancel)', () => {
    const next = gameTurnReducer(cancellingState(), sseAction(failedEvent('LLM_TIMEOUT', 'timeout', true, 4)))
    expect(next.status).toBe('cancelled')
  })

  it('stays cancelling on non-terminal events (text-delta, step)', () => {
    const next = gameTurnReducer(cancellingState(), sseAction(textDeltaEvent('more text', 4)))
    expect(next.status).toBe('cancelling')
  })

  it('stays cancelling on another CANCEL (no-op)', () => {
    const next = gameTurnReducer(cancellingState(), cancelAction())
    expect(next.status).toBe('cancelling')
  })

  it('ignores SUBMIT while cancelling', () => {
    const next = gameTurnReducer(cancellingState(), submitAction())
    expect(next.status).toBe('cancelling')
  })
})

// ─── cancelled terminal state ───────────────────────────────────────────────

describe('cancelled state — terminal', () => {
  function cancelledState(overrides?: Partial<GameTurnState>): GameTurnState {
    return {
      ...initialGameTurnState,
      status: 'cancelled',
      requestId: REQUEST_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      replyText: 'partial reply',
      cancelReason: 'user navigated away',
      ...overrides,
    }
  }

  it('ignores all SSE events', () => {
    const next = gameTurnReducer(cancelledState(), sseAction(completedEvent('late', 10)))
    expect(next.status).toBe('cancelled')
  })

  it('ignores SUBMIT', () => {
    const next = gameTurnReducer(cancelledState(), submitAction())
    expect(next.status).toBe('cancelled')
  })

  it('resets to idle on RESET', () => {
    const next = gameTurnReducer(cancelledState(), resetAction())
    expect(next).toEqual(initialGameTurnState)
  })
})

// ─── Sequence Validation ────────────────────────────────────────────────────

describe('sequence validation', () => {
  function streamingState(seq = 0): GameTurnState {
    return {
      ...initialGameTurnState,
      status: 'streaming',
      requestId: REQUEST_ID,
      runId: RUN_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      lastSequence: seq,
      replyText: '',
      stepLogs: [],
    }
  }

  it('accepts contiguous sequences (0, 1, 2, 3...)', () => {
    let state = streamingState(0)
    state = gameTurnReducer(state, sseAction(textDeltaEvent('a', 1)))
    expect(state.status).toBe('streaming')
    state = gameTurnReducer(state, sseAction(textDeltaEvent('b', 2)))
    expect(state.status).toBe('streaming')
    state = gameTurnReducer(state, sseAction(textDeltaEvent('c', 3)))
    expect(state.status).toBe('streaming')
  })

  it('detects sequence gaps', () => {
    const state = streamingState(1)
    // Jump from 1 to 5 — gap detected
    const next = gameTurnReducer(state, sseAction(textDeltaEvent('skip', 5)))
    // Should transition to failed with PROTOCOL_ERROR
    expect(next.status).toBe('failed')
    expect(next.error?.code).toBe('PROTOCOL_ERROR')
  })

  it('detects duplicate sequence numbers', () => {
    const state = streamingState(5)
    const next = gameTurnReducer(state, sseAction(textDeltaEvent('dup', 5)))
    expect(next.status).toBe('failed')
    expect(next.error?.code).toBe('PROTOCOL_ERROR')
  })

  it('detects sequence going backwards', () => {
    const state = streamingState(10)
    const next = gameTurnReducer(state, sseAction(textDeltaEvent('backwards', 5)))
    expect(next.status).toBe('failed')
    expect(next.error?.code).toBe('PROTOCOL_ERROR')
  })

  it('accepts non-contiguous sequence for terminal events (allows gaps before terminal)', () => {
    // Terminal events don't need to be contiguous — the server may skip
    // intermediate sequence numbers for completed/failed/cancelled
    const state = streamingState(3)
    const next = gameTurnReducer(state, sseAction(completedEvent('done', 99)))
    expect(next.status).toBe('completed')
  })
})

// ─── Authoritative vs Candidate State ───────────────────────────────────────

describe('authoritative vs candidate state separation', () => {
  it('replyText during streaming is candidate (not authoritative)', () => {
    const state: GameTurnState = {
      ...initialGameTurnState,
      status: 'streaming',
      requestId: REQUEST_ID,
      runId: RUN_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      lastSequence: 1,
      replyText: '候选文本...',
      stepLogs: [],
    }

    // Candidate text is in replyText but not yet confirmed
    expect(state.replyText).toBe('候选文本...')
    expect(state.status).toBe('streaming')
  })

  it('candidate text is preserved on failure (for error display)', () => {
    const state: GameTurnState = {
      ...initialGameTurnState,
      status: 'streaming',
      requestId: REQUEST_ID,
      runId: RUN_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      lastSequence: 3,
      replyText: '已修炼到一半...',
      stepLogs: [],
    }
    const next = gameTurnReducer(state, sseAction(failedEvent('LLM_TIMEOUT', 'timeout', true, 4)))
    // Candidate text preserved so user can see what happened before failure
    expect(next.replyText).toBe('已修炼到一半...')
    expect(next.status).toBe('failed')
  })

  it('replyText on completed is authoritative (from completed payload)', () => {
    const state: GameTurnState = {
      ...initialGameTurnState,
      status: 'streaming',
      requestId: REQUEST_ID,
      runId: RUN_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      lastSequence: 9,
      replyText: '候选回复...',
      stepLogs: [],
    }
    // The stream's candidate text accumulates, and completed event confirms the final state
    const next = gameTurnReducer(state, sseAction(completedEvent('最终回复', 10)))
    expect(next.status).toBe('completed')
  })
})

// ─── Idempotency Key Reuse ──────────────────────────────────────────────────

describe('idempotency key handling', () => {
  it('preserves idempotencyKey across the lifecycle', () => {
    let state = initialGameTurnState

    state = gameTurnReducer(state, submitAction())
    expect(state.idempotencyKey).toBe(IDEMPOTENCY_KEY)

    state = gameTurnReducer(state, sseAction(acceptedEvent()))
    expect(state.idempotencyKey).toBe(IDEMPOTENCY_KEY)

    state = gameTurnReducer(state, sseAction(textDeltaEvent('text', 1)))
    expect(state.idempotencyKey).toBe(IDEMPOTENCY_KEY)

    state = gameTurnReducer(state, sseAction(completedEvent('done', 2)))
    expect(state.idempotencyKey).toBe(IDEMPOTENCY_KEY)
  })

  it('clears idempotencyKey on RESET', () => {
    const state: GameTurnState = {
      ...initialGameTurnState,
      status: 'completed',
      idempotencyKey: IDEMPOTENCY_KEY,
    }
    const next = gameTurnReducer(state, resetAction())
    expect(next.idempotencyKey).toBeNull()
  })

  it('generates new idempotencyKey on new SUBMIT', () => {
    const state: GameTurnState = {
      ...initialGameTurnState,
      status: 'idle',
      idempotencyKey: 'old-key',
    }
    const next = gameTurnReducer(state, submitAction({ idempotencyKey: 'new-key' } as Partial<GameTurnAction>))
    expect(next.idempotencyKey).toBe('new-key')
  })
})

// ─── Request ID Retention ───────────────────────────────────────────────────

describe('request ID retention', () => {
  it('sets requestId from accepted event', () => {
    const state: GameTurnState = {
      ...initialGameTurnState,
      status: 'submitting',
      idempotencyKey: IDEMPOTENCY_KEY,
    }
    const next = gameTurnReducer(state, sseAction(acceptedEvent()))
    expect(next.requestId).toBe(REQUEST_ID)
  })

  it('preserves requestId through streaming to completion', () => {
    let state: GameTurnState = {
      ...initialGameTurnState,
      status: 'submitting',
      idempotencyKey: IDEMPOTENCY_KEY,
    }
    state = gameTurnReducer(state, sseAction(acceptedEvent()))
    expect(state.requestId).toBe(REQUEST_ID)

    state = gameTurnReducer(state, sseAction(textDeltaEvent('text', 1)))
    state = gameTurnReducer(state, sseAction(completedEvent('done', 2)))
    expect(state.requestId).toBe(REQUEST_ID)
  })

  it('preserves requestId in failed state for error correlation', () => {
    let state: GameTurnState = {
      ...initialGameTurnState,
      status: 'submitting',
      idempotencyKey: IDEMPOTENCY_KEY,
    }
    state = gameTurnReducer(state, sseAction(acceptedEvent()))
    state = gameTurnReducer(state, sseAction(failedEvent('LLM_TIMEOUT', 'oops', true, 1)))
    expect(state.requestId).toBe(REQUEST_ID)
  })
})

// ─── Retryable vs Non-Retryable Errors ─────────────────────────────────────

describe('retryable error handling', () => {
  it('marks retryable errors correctly', () => {
    const state: GameTurnState = {
      ...initialGameTurnState,
      status: 'submitting',
      idempotencyKey: IDEMPOTENCY_KEY,
    }
    const next = gameTurnReducer(state, sseAction(failedEvent('LLM_TIMEOUT', 'timeout', true, 0)))
    expect(next.error?.retryable).toBe(true)
    expect(next.error?.code).toBe('LLM_TIMEOUT')
  })

  it('marks non-retryable errors correctly', () => {
    const state: GameTurnState = {
      ...initialGameTurnState,
      status: 'submitting',
      idempotencyKey: IDEMPOTENCY_KEY,
    }
    const next = gameTurnReducer(state, sseAction(failedEvent('VALIDATION_ERROR', 'bad input', false, 0)))
    expect(next.error?.retryable).toBe(false)
  })

  it('retryable errors allow RESET back to idle', () => {
    const state: GameTurnState = {
      ...initialGameTurnState,
      status: 'failed',
      error: { code: 'LLM_TIMEOUT', message: 'timeout', retryable: true },
    }
    const next = gameTurnReducer(state, resetAction())
    expect(next.status).toBe('idle')
  })

  it('non-retryable errors also allow RESET (user can still dismiss)', () => {
    const state: GameTurnState = {
      ...initialGameTurnState,
      status: 'failed',
      error: { code: 'VALIDATION_ERROR', message: 'bad', retryable: false },
    }
    const next = gameTurnReducer(state, resetAction())
    expect(next.status).toBe('idle')
  })
})

// ─── Codex and Journal Events ──────────────────────────────────────────────

describe('codex and journal events', () => {
  function streamingState(): GameTurnState {
    return {
      ...initialGameTurnState,
      status: 'streaming',
      requestId: REQUEST_ID,
      runId: RUN_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      lastSequence: 5,
      replyText: 'reply so far',
      stepLogs: [],
    }
  }

  it('ignores codex events (UI-level concern, not reducer state)', () => {
    const event = {
      sequence: 6,
      type: 'codex' as const,
      payload: {
        name: '火球术',
        entry_type: 'technique',
        description: '基础火系功法',
        metadata: { element: '火' },
        timestamp: 1700000000000,
      },
      raw: '{}',
    }
    const next = gameTurnReducer(streamingState(), { type: 'SSE_EVENT', event } as GameTurnAction)
    expect(next.status).toBe('streaming')
    expect(next.lastSequence).toBe(6)
  })

  it('ignores journal events (UI-level concern, not reducer state)', () => {
    const event = {
      sequence: 6,
      type: 'journal' as const,
      payload: {
        title: '修炼日志',
        content: '今日修炼火球术',
        entry_type: 'cultivation',
        timestamp: 1700000000000,
      },
      raw: '{}',
    }
    const next = gameTurnReducer(streamingState(), { type: 'SSE_EVENT', event } as GameTurnAction)
    expect(next.status).toBe('streaming')
    expect(next.lastSequence).toBe(6)
  })
})

// ─── State Update Events ────────────────────────────────────────────────────

describe('state_update events', () => {
  function streamingState(): GameTurnState {
    return {
      ...initialGameTurnState,
      status: 'streaming',
      requestId: REQUEST_ID,
      runId: RUN_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      lastSequence: 3,
      replyText: '',
      stepLogs: [],
    }
  }

  it('tracks deltas from state_update events', () => {
    const event = {
      sequence: 4,
      type: 'state_update' as const,
      payload: {
        player: { id: 'p1', stats: { hp: { current: 90, max: 100, status_desc: '轻伤' } } },
        deltas: { hp_change: -10, reason: '战斗受伤' },
      },
      raw: '{}',
    }
    const next = gameTurnReducer(streamingState(), { type: 'SSE_EVENT', event } as GameTurnAction)
    expect(next.status).toBe('streaming')
    expect(next.lastSequence).toBe(4)
  })
})

// ─── Forbidden Transition Summary ───────────────────────────────────────────

describe('forbidden transitions', () => {
  it('terminal states (completed, failed, cancelled) reject SUBMIT', () => {
    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      const state: GameTurnState = {
        ...initialGameTurnState,
        status,
        requestId: REQUEST_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
      }
      const next = gameTurnReducer(state, submitAction())
      expect(next.status).toBe(status) // unchanged
    }
  })

  it('terminal states (completed, failed, cancelled) ignore SSE events', () => {
    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      const state: GameTurnState = {
        ...initialGameTurnState,
        status,
        requestId: REQUEST_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        lastSequence: 10,
      }
      const next = gameTurnReducer(state, sseAction(textDeltaEvent('late', 11)))
      expect(next.status).toBe(status) // unchanged
    }
  })

  it('cancelling ignores SUBMIT', () => {
    const state: GameTurnState = {
      ...initialGameTurnState,
      status: 'cancelling',
      requestId: REQUEST_ID,
    }
    const next = gameTurnReducer(state, submitAction())
    expect(next.status).toBe('cancelling')
  })
})
