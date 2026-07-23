/**
 * SSE protocol fixture data for reuse across server and client tests.
 *
 * Each fixture provides:
 * - Raw SSE text/event-stream bytes (as Uint8Array)
 * - Expected parsed events with types, sequences, and payloads
 * - Error assertions for invalid streams
 *
 * Fixtures cover:
 * - Normal completion (accepted → text-delta → completed)
 * - Known failure (accepted → failed with Problem Details)
 * - Unknown/unexpected error
 * - User cancellation
 * - Malformed event (invalid JSON)
 * - Missing sequence number
 * - Duplicate terminal event
 * - Interrupted stream (no terminal)
 */
import { PROTOCOL_VERSION } from '@/server/contracts/sse-events'

// ─── Helpers ────────────────────────────────────────────────────────────────

function env(requestId: string, runId: string, sequence: number, type: string, payload: unknown) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    runId,
    sequence,
    occurredAt: '2026-07-23T00:00:00.000Z',
    type,
    payload,
  }
}

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

function sseEventString(eventType: string, data: unknown): string {
  return `event: ${eventType}\n${sse(data).trimEnd()}\n\n`
}

function text(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

// ─── Request/Player IDs ─────────────────────────────────────────────────────

export const FIXTURE_REQUEST_ID = 'req-fixture-001'
export const FIXTURE_RUN_ID = 'run-fixture-001'
export const FIXTURE_PLAYER_ID = 'player-fixture-001'

// ─── 1. Normal Completion ───────────────────────────────────────────────────

export const normalCompletionRaw = text(
  sseEventString('accepted', env(FIXTURE_REQUEST_ID, FIXTURE_RUN_ID, 0, 'accepted', {
    requestId: FIXTURE_REQUEST_ID,
    runId: FIXTURE_RUN_ID,
    playerId: FIXTURE_PLAYER_ID,
    mode: 'action',
  })) +
  sseEventString('text-delta', env(FIXTURE_REQUEST_ID, FIXTURE_RUN_ID, 1, 'text-delta', {
    content: '你运转功法，',
  })) +
  sseEventString('text-delta', env(FIXTURE_REQUEST_ID, FIXTURE_RUN_ID, 2, 'text-delta', {
    content: '感受到灵气在体内流转。',
  })) +
  sseEventString('completed', env(FIXTURE_REQUEST_ID, FIXTURE_RUN_ID, 3, 'completed', {
    reply: '你运转功法，感受到灵气在体内流转。修炼完成。',
    stats: { hp: 105, mp: 48 },
  })),
)

export const normalCompletionEvents = [
  { type: 'accepted', sequence: 0 },
  { type: 'text-delta', sequence: 1, content: '你运转功法，' },
  { type: 'text-delta', sequence: 2, content: '感受到灵气在体内流转。' },
  { type: 'completed', sequence: 3, reply: '你运转功法，感受到灵气在体内流转。修炼完成。' },
]

// ─── 2. Known Failure (LLM Timeout) ────────────────────────────────────────

export const knownFailureRaw = text(
  sseEventString('accepted', env(FIXTURE_REQUEST_ID, FIXTURE_RUN_ID, 0, 'accepted', {
    requestId: FIXTURE_REQUEST_ID,
    runId: FIXTURE_RUN_ID,
    playerId: FIXTURE_PLAYER_ID,
    mode: 'action',
  })) +
  sseEventString('failed', env(FIXTURE_REQUEST_ID, FIXTURE_RUN_ID, 1, 'failed', {
    type: 'https://api.xiuxian.com/errors/llm-timeout',
    title: 'LLM Timeout',
    status: 504,
    detail: 'The LLM provider timed out after 30 seconds',
    code: 'LLM_TIMEOUT',
    requestId: FIXTURE_REQUEST_ID,
    retryable: true,
  })),
)

export const knownFailurePayload = {
  code: 'LLM_TIMEOUT',
  retryable: true,
  status: 504,
}

// ─── 3. Unknown/Unexpected Failure ─────────────────────────────────────────

export const unknownFailureRaw = text(
  sseEventString('accepted', env(FIXTURE_REQUEST_ID, FIXTURE_RUN_ID, 0, 'accepted', {
    requestId: FIXTURE_REQUEST_ID,
    runId: FIXTURE_RUN_ID,
    playerId: FIXTURE_PLAYER_ID,
    mode: 'action',
  })) +
  sseEventString('failed', env(FIXTURE_REQUEST_ID, FIXTURE_RUN_ID, 1, 'failed', {
    type: 'https://api.xiuxian.com/errors/internal-error',
    title: 'Internal Server Error',
    status: 500,
    detail: 'An unexpected error occurred',
    code: 'INTERNAL_ERROR',
    requestId: FIXTURE_REQUEST_ID,
    retryable: false,
  })),
)

export const unknownFailurePayload = {
  code: 'INTERNAL_ERROR',
  retryable: false,
  status: 500,
}

// ─── 4. Cancellation ───────────────────────────────────────────────────────

export const cancellationRaw = text(
  sseEventString('accepted', env(FIXTURE_REQUEST_ID, FIXTURE_RUN_ID, 0, 'accepted', {
    requestId: FIXTURE_REQUEST_ID,
    runId: FIXTURE_RUN_ID,
    playerId: FIXTURE_PLAYER_ID,
    mode: 'action',
  })) +
  sseEventString('cancelled', env(FIXTURE_REQUEST_ID, FIXTURE_RUN_ID, 1, 'cancelled', {
    requestId: FIXTURE_REQUEST_ID,
    runId: FIXTURE_RUN_ID,
    reason: 'User navigated away',
  })),
)

export const cancellationReason = 'User navigated away'

// ─── 5. Malformed Event (Invalid JSON) ─────────────────────────────────────

export const malformedEventRaw = text(
  sseEventString('accepted', env(FIXTURE_REQUEST_ID, FIXTURE_RUN_ID, 0, 'accepted', {
    requestId: FIXTURE_REQUEST_ID,
    runId: FIXTURE_RUN_ID,
    playerId: FIXTURE_PLAYER_ID,
    mode: 'action',
  })) +
  'event: text-delta\ndata: {invalid json {{{{{\n\n',
)

// ─── 6. Missing Sequence Number ─────────────────────────────────────────────

export const missingSequenceRaw = text(
  sseEventString('accepted', env(FIXTURE_REQUEST_ID, FIXTURE_RUN_ID, 0, 'accepted', {
    requestId: FIXTURE_REQUEST_ID,
    runId: FIXTURE_RUN_ID,
    playerId: FIXTURE_PLAYER_ID,
    mode: 'action',
  })) +
  // Sequence 1 → 5 jump (gap: 2, 3, 4 missing)
  sseEventString('text-delta', env(FIXTURE_REQUEST_ID, FIXTURE_RUN_ID, 1, 'text-delta', {
    content: 'first delta',
  })) +
  sseEventString('text-delta', env(FIXTURE_REQUEST_ID, FIXTURE_RUN_ID, 5, 'text-delta', {
    content: 'skipped delta',
  })),
)

// ─── 7. Duplicate Terminal ──────────────────────────────────────────────────

export const duplicateTerminalRaw = text(
  sseEventString('accepted', env(FIXTURE_REQUEST_ID, FIXTURE_RUN_ID, 0, 'accepted', {
    requestId: FIXTURE_REQUEST_ID,
    runId: FIXTURE_RUN_ID,
    playerId: FIXTURE_PLAYER_ID,
    mode: 'action',
  })) +
  sseEventString('completed', env(FIXTURE_REQUEST_ID, FIXTURE_RUN_ID, 1, 'completed', {
    reply: 'first completion',
  })) +
  sseEventString('completed', env(FIXTURE_REQUEST_ID, FIXTURE_RUN_ID, 2, 'completed', {
    reply: 'DUPLICATE — this should be rejected',
  })),
)

// ─── 8. Interrupted Stream (No Terminal) ───────────────────────────────────

export const interruptedStreamRaw = text(
  sseEventString('accepted', env(FIXTURE_REQUEST_ID, FIXTURE_RUN_ID, 0, 'accepted', {
    requestId: FIXTURE_REQUEST_ID,
    runId: FIXTURE_RUN_ID,
    playerId: FIXTURE_PLAYER_ID,
    mode: 'action',
  })) +
  sseEventString('text-delta', env(FIXTURE_REQUEST_ID, FIXTURE_RUN_ID, 1, 'text-delta', {
    content: '修炼进行中...',
  })) +
  // No terminal event — connection drops
  'event: text-delta\ndata: ' + JSON.stringify(
    env(FIXTURE_REQUEST_ID, FIXTURE_RUN_ID, 2, 'text-delta', { content: 'partial event' }),
  ).slice(0, 30), // deliberately cut off
)

// ─── 9. All Fixtures Index ──────────────────────────────────────────────────

export const allFixtures = [
  { name: 'normalCompletion', raw: normalCompletionRaw, terminalExpected: 'completed' as const },
  { name: 'knownFailure', raw: knownFailureRaw, terminalExpected: 'failed' as const },
  { name: 'unknownFailure', raw: unknownFailureRaw, terminalExpected: 'failed' as const },
  { name: 'cancellation', raw: cancellationRaw, terminalExpected: 'cancelled' as const },
  { name: 'malformedEvent', raw: malformedEventRaw, terminalExpected: null },
  { name: 'missingSequence', raw: missingSequenceRaw, terminalExpected: null },
  { name: 'duplicateTerminal', raw: duplicateTerminalRaw, terminalExpected: null },
  { name: 'interruptedStream', raw: interruptedStreamRaw, terminalExpected: null },
] as const
