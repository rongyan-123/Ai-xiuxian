/**
 * Task 2.1 & 2.2: API contract tests.
 *
 * Every schema under test is IMPORTED from the production contracts
 * (src/server/contracts/). No schema is declared or duplicated in this file.
 */
import { describe, it, expect } from 'vitest'

import { GameActionRequestSchema, PlayerResponseSchema } from '@/server/contracts/game-action'
import {
  ProblemDetailsSchema,
  ValidationErrorSchema,
} from '@/server/contracts/problem-details'
import {
  PlayerSnapshotSchema,
  CharacterStatsSchema,
  InventoryItemSchema,
} from '@/server/contracts/player'
import {
  SSEEventEnvelopeSchema,
  SSEEventSchema,
  AcceptedPayloadSchema,
  StepPayloadSchema,
  TextDeltaPayloadSchema,
  CodexPayloadSchema,
  JournalPayloadSchema,
  StateUpdatePayloadSchema,
  CompletedPayloadSchema,
  FailedPayloadSchema,
  CancelledPayloadSchema,
} from '@/server/contracts/sse-events'
import { LLMResponseSchema } from '@/server/contracts/provider'

// ─── 2.1a: Game-action request validation ────────────────────────────────

describe('2.1a GameActionRequest Schema', () => {
  it('rejects malformed JSON (non-object)', () => {
    const r = GameActionRequestSchema.safeParse('not an object')
    expect(r.success).toBe(false)
  })

  it('rejects null', () => {
    const r = GameActionRequestSchema.safeParse(null)
    expect(r.success).toBe(false)
  })

  it('rejects empty input string', () => {
    const r = GameActionRequestSchema.safeParse({ input: '', playerId: 'p1' })
    expect(r.success).toBe(false)
  })

  it('rejects missing input field', () => {
    const r = GameActionRequestSchema.safeParse({ playerId: 'p1' })
    expect(r.success).toBe(false)
  })

  it('rejects missing playerId field', () => {
    const r = GameActionRequestSchema.safeParse({ input: 'hello' })
    expect(r.success).toBe(false)
  })

  it('rejects empty playerId', () => {
    const r = GameActionRequestSchema.safeParse({ input: 'hello', playerId: '' })
    expect(r.success).toBe(false)
  })

  it('rejects invalid mode', () => {
    const r = GameActionRequestSchema.safeParse({ input: 'hello', playerId: 'p1', mode: 'invalid' })
    expect(r.success).toBe(false)
  })

  it('accepts valid action request', () => {
    const r = GameActionRequestSchema.safeParse({ input: '修炼', playerId: 'player-1', mode: 'action' })
    expect(r.success).toBe(true)
  })

  it('accepts request with idempotencyKey', () => {
    const r = GameActionRequestSchema.safeParse({
      input: '修炼', playerId: 'player-1',
      idempotencyKey: 'ik-abc123',
      playerName: '测试道人',
    })
    expect(r.success).toBe(true)
  })

  it('rejects extra unknown fields (strictObject)', () => {
    // GameActionRequestSchema uses z.strictObject, so extra keys are always rejected
    const r = GameActionRequestSchema.safeParse({ input: 'x', playerId: 'p1', injectedHack: true })
    expect(r.success).toBe(false)
  })
})

// ─── 2.1b: Problem Details (RFC 9457) ────────────────────────────────────

describe('2.1b Problem Details (RFC 9457)', () => {
  it('validates a valid 422 Problem Details response', () => {
    const body = {
      type: 'https://api.xiuxian.com/errors/validation-error',
      title: 'Validation Error',
      status: 422,
      detail: 'The request body failed validation.',
      code: 'VALIDATION_ERROR',
      requestId: 'req-abc123',
      retryable: false,
    }
    expect(ProblemDetailsSchema.safeParse(body).success).toBe(true)
  })

  it('validates a 500 Problem Details response', () => {
    const body = {
      type: 'https://api.xiuxian.com/errors/internal-error',
      title: 'Internal Server Error',
      status: 500,
      detail: 'An unexpected error occurred.',
      code: 'INTERNAL_ERROR',
      requestId: 'req-xyz789',
      retryable: false,
    }
    expect(ProblemDetailsSchema.safeParse(body).success).toBe(true)
  })

  it('rejects missing code field', () => {
    const body = { type: 'https://x.com/e', title: 'Error', status: 500, detail: 'err', requestId: 'r1', retryable: false }
    // Missing 'code' — the body literal doesn't include it, so safeParse fails
    const bad: Record<string, unknown> = { type: 'https://x.com/e', title: 'Error', status: 500, detail: 'err', requestId: 'r1', retryable: false }
    expect(ProblemDetailsSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects missing requestId field', () => {
    const bad = { type: 'https://x.com/e', title: 'Error', status: 500, detail: 'err', code: 'E1', retryable: false }
    // Missing 'requestId'
    expect(ProblemDetailsSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects missing retryable field', () => {
    const body = { type: 'https://x.com/e', title: 'Error', status: 500, detail: 'err', code: 'E1', requestId: 'r1' }
    expect(ProblemDetailsSchema.safeParse(body).success).toBe(false)
  })

  it('rejects invalid status code (0)', () => {
    const body = { type: 'https://x.com/e', title: 'Error', status: 0, detail: 'err', code: 'E1', requestId: 'r1', retryable: false }
    expect(ProblemDetailsSchema.safeParse(body).success).toBe(false)
  })

  it('rejects invalid status code (600)', () => {
    const body = { type: 'https://x.com/e', title: 'Error', status: 600, detail: 'err', code: 'E1', requestId: 'r1', retryable: false }
    expect(ProblemDetailsSchema.safeParse(body).success).toBe(false)
  })

  it('rejects invalid type (not a URL)', () => {
    const body = { type: 'not-a-url', title: 'Error', status: 500, detail: 'err', code: 'E1', requestId: 'r1', retryable: false }
    expect(ProblemDetailsSchema.safeParse(body).success).toBe(false)
  })

  it('validates with optional instance field', () => {
    const body = {
      type: 'https://api.xiuxian.com/errors/not-found',
      title: 'Not Found', status: 404, detail: 'Player not found.',
      instance: '/api/v1/players/nonexistent',
      code: 'NOT_FOUND', requestId: 'r1', retryable: false,
    }
    expect(ProblemDetailsSchema.safeParse(body).success).toBe(true)
  })
})

// ─── 2.1c: Validation error with issue pointers ──────────────────────────

describe('2.1c Validation error issue pointers', () => {
  it('validates validation error with issue pointers', () => {
    const body = {
      type: 'https://api.xiuxian.com/errors/validation-error',
      title: 'Validation Error',
      status: 422,
      detail: 'The request body failed validation.',
      code: 'VALIDATION_ERROR',
      requestId: 'req-abc',
      retryable: false,
      errors: [
        { pointer: '/input', message: 'Required' },
        { pointer: '/playerId', message: 'Must be a non-empty string' },
      ],
    }
    expect(ValidationErrorSchema.safeParse(body).success).toBe(true)
  })
})

// ─── 2.1d: Success payloads ──────────────────────────────────────────────

describe('2.1d Success payload schemas', () => {
  it('validates a player response', () => {
    const p = {
      player: {
        id: 'p1', status: 'ALIVE', name: '测试道人', gender: '男',
        stats: {
          hp: { current: 100, max: 100, status_desc: '良好' },
          mp: { current: 50, max: 50, status_desc: '充沛' },
          spirit: { value: 100, desc: '饱满' },
          realm: '练气期一层', age: { current: 16, max: 100 },
          race: '人族', alignment: '中立', sect: '散修',
          spiritual_root: '五行杂灵根', mental_state: '心如止水', reputation: 0,
        },
        inventory: [],
        codex: [],
        relationships: {},
        worldTime: 1700000000000,
        currentLocation: '新手村',
        npcs: [],
      },
    }
    expect(PlayerResponseSchema.safeParse(p).success).toBe(true)
  })

  it('rejects player response with invalid HP', () => {
    const p = {
      player: {
        id: 'p1', status: 'ALIVE', name: 'test', gender: '男',
        stats: {
          hp: { current: 'not-a-number', max: 100, status_desc: '良好' },
          mp: { current: 50, max: 50, status_desc: '充沛' },
          spirit: { value: 100, desc: 'ok' },
          realm: '练气期一层', age: { current: 16, max: 100 },
          race: '人族', alignment: '中立', sect: '散修',
          spiritual_root: '', mental_state: '', reputation: 0,
        },
        inventory: [], codex: [], relationships: {},
        worldTime: 1700000000000,
        currentLocation: '新手村',
        npcs: [],
      },
    }
    expect(PlayerResponseSchema.safeParse(p).success).toBe(false)
  })
})

// ─── 2.1e: Persisted player JSON ─────────────────────────────────────────

describe('2.1e Persisted player JSON', () => {
  it('validates player stats JSON as stored in Prisma', () => {
    const validStats = {
      hp: { current: 100, max: 100, status_desc: '良好' },
      mp: { current: 50, max: 50, status_desc: '充沛' },
      spirit: { value: 100, desc: '饱满' },
      realm: '练气期一层',
      age: { current: 16, max: 100 },
      race: '人族', alignment: '中立', sect: '散修',
      spiritual_root: '五行杂灵根', mental_state: '心如止水', reputation: 10,
      state_of_mind: 75, karma: 5, shield: { current: 30, max: 50 },
    }
    expect(CharacterStatsSchema.safeParse(validStats).success).toBe(true)
  })

  it('rejects stats with non-numeric HP current', () => {
    const badStats = {
      hp: { current: 'one hundred', max: 100, status_desc: 'ok' },
      mp: { current: 50, max: 50, status_desc: 'ok' },
      spirit: { value: 100, desc: 'ok' },
      realm: 'x', age: { current: 16, max: 100 },
      race: 'x', alignment: 'x', sect: 'x',
      spiritual_root: 'x', mental_state: 'x', reputation: 0,
    }
    expect(CharacterStatsSchema.safeParse(badStats).success).toBe(false)
  })
})

// ─── 2.1f: Provider (LLM) response ───────────────────────────────────────

describe('2.1f Provider response schemas', () => {
  it('validates a valid OpenAI chat completion response', () => {
    const response = {
      id: 'chatcmpl-abc123',
      object: 'chat.completion',
      created: 1700000000,
      model: 'gpt-4o-mini',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: '天地灵气涌动，你运转功法...',
        },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 500, completion_tokens: 200, total_tokens: 700 },
    }
    expect(LLMResponseSchema.safeParse(response).success).toBe(true)
  })

  it('validates a response with tool calls', () => {
    const response = {
      id: 'chatcmpl-xyz',
      object: 'chat.completion',
      created: 1700000000,
      model: 'gpt-4o-mini',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'Modify_Stats', arguments: '{"hp_change": -10}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    }
    expect(LLMResponseSchema.safeParse(response).success).toBe(true)
  })

  it('rejects response with wrong object type', () => {
    const bad = { id: 'x', object: 'not.chat.completion', created: 1, model: 'm', choices: [] }
    expect(LLMResponseSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects response with unknown message role', () => {
    const bad = {
      id: 'x', object: 'chat.completion', created: 1, model: 'm',
      choices: [{ index: 0, message: { role: 'system', content: 'x' }, finish_reason: 'stop' }],
    }
    expect(LLMResponseSchema.safeParse(bad).success).toBe(false)
  })
})

// ─── 2.1g: SSE event payloads — every event type ─────────────────────────

describe('2.1g SSE event payloads', () => {
  it('validates accepted event payload', () => {
    expect(AcceptedPayloadSchema.safeParse({
      requestId: 'req-1', runId: 'run-1', playerId: 'p1', mode: 'action',
    }).success).toBe(true)
  })

  it('rejects accepted event missing runId', () => {
    expect(AcceptedPayloadSchema.safeParse({
      requestId: 'req-1', playerId: 'p1', mode: 'action',
    }).success).toBe(false)
  })

  it('validates step event payload', () => {
    expect(StepPayloadSchema.safeParse({ label: '天道记忆检索中...' }).success).toBe(true)
  })

  it('validates text-delta event payload', () => {
    expect(TextDeltaPayloadSchema.safeParse({ content: '天地玄黄' }).success).toBe(true)
  })

  it('rejects text-delta with non-string content', () => {
    expect(TextDeltaPayloadSchema.safeParse({ content: 123 }).success).toBe(false)
  })

  it('validates codex event payload', () => {
    expect(CodexPayloadSchema.safeParse({
      name: '青云剑', entry_type: 'item', description: '一把古剑',
      metadata: {}, timestamp: 1700000000,
    }).success).toBe(true)
  })

  it('rejects codex event missing required fields', () => {
    expect(CodexPayloadSchema.safeParse({ name: 'x' }).success).toBe(false)
  })

  it('validates journal event payload', () => {
    expect(JournalPayloadSchema.safeParse({
      title: '突破筑基', content: '内容', entry_type: 'success', timestamp: 1700000000,
    }).success).toBe(true)
  })

  it('rejects journal event missing timestamp', () => {
    expect(JournalPayloadSchema.safeParse({
      title: 'x', content: 'x', entry_type: 'general',
    }).success).toBe(false)
  })

  it('validates state_update event payload', () => {
    const p = {
      id: 'p1', status: 'ALIVE', name: '道人', gender: '男',
      stats: {
        hp: { current: 90, max: 100, status_desc: '轻伤' },
        mp: { current: 50, max: 50, status_desc: '充沛' },
        spirit: { value: 100, desc: '饱满' },
        realm: '练气期一层', age: { current: 16, max: 100 },
        race: '人族', alignment: '中立', sect: '散修',
        spiritual_root: '杂灵根', mental_state: '平静', reputation: 0,
      },
      inventory: [], codex: [], relationships: {},
      worldTime: 1700000000000,
      currentLocation: '新手村',
      npcs: [],
    }
    expect(StateUpdatePayloadSchema.safeParse({
      player: p, deltas: { stats: { hp_change: -10 } },
    }).success).toBe(true)
  })

  it('validates completed event payload', () => {
    expect(CompletedPayloadSchema.safeParse({
      reply: '天地灵气汇聚，你完成了修炼。',
    }).success).toBe(true)
  })

  it('rejects completed event with non-string reply', () => {
    expect(CompletedPayloadSchema.safeParse({ reply: 123 }).success).toBe(false)
  })

  it('validates failed event payload as Problem Details', () => {
    expect(FailedPayloadSchema.safeParse({
      type: 'https://api.xiuxian.com/errors/llm-timeout',
      title: 'LLM Timeout', status: 504, detail: 'LLM call exceeded deadline.',
      code: 'LLM_TIMEOUT', requestId: 'req-1', retryable: true,
    }).success).toBe(true)
  })

  it('validates cancelled event payload', () => {
    expect(CancelledPayloadSchema.safeParse({
      requestId: 'req-1', runId: 'run-1',
    }).success).toBe(true)
  })

  it('validates a complete SSE event envelope', () => {
    const event = {
      protocolVersion: '1.0',
      requestId: 'req-abc',
      runId: 'run-xyz',
      sequence: 1,
      occurredAt: '2026-07-22T00:00:00.000Z',
      type: 'text-delta',
      payload: { content: '天地' },
    }
    expect(SSEEventEnvelopeSchema.safeParse(event).success).toBe(true)
  })

  it('rejects envelope missing protocolVersion', () => {
    const event = {
      requestId: 'r1', runId: 'r1', sequence: 1,
      occurredAt: '2026-01-01T00:00:00Z', type: 'step', payload: {},
    }
    expect(SSEEventEnvelopeSchema.safeParse(event).success).toBe(false)
  })

  it('rejects envelope with negative sequence', () => {
    const event = {
      protocolVersion: '1.0', requestId: 'r1', runId: 'r1',
      sequence: -1, occurredAt: '2026-01-01T00:00:00Z', type: 'step', payload: {},
    }
    expect(SSEEventEnvelopeSchema.safeParse(event).success).toBe(false)
  })

  it('rejects envelope with non-integer sequence', () => {
    const event = {
      protocolVersion: '1.0', requestId: 'r1', runId: 'r1',
      sequence: 1.5, occurredAt: '2026-01-01T00:00:00Z', type: 'step', payload: {},
    }
    expect(SSEEventEnvelopeSchema.safeParse(event).success).toBe(false)
  })

  it('rejects envelope with missing type', () => {
    const event = {
      protocolVersion: '1.0', requestId: 'r1', runId: 'r1',
      sequence: 0, occurredAt: '2026-01-01T00:00:00Z', payload: {},
    }
    expect(SSEEventEnvelopeSchema.safeParse(event).success).toBe(false)
  })

  // ── Discriminated union: type binds to exact payload ──

  it('discriminated union: accepted event with correct payload passes', () => {
    const event = {
      protocolVersion: '1.0',
      requestId: 'req-1', runId: 'run-1', sequence: 0,
      occurredAt: '2026-07-22T00:00:00.000Z',
      type: 'accepted',
      payload: { requestId: 'req-1', runId: 'run-1', playerId: 'p1', mode: 'action' },
    }
    expect(SSEEventSchema.safeParse(event).success).toBe(true)
  })

  it('discriminated union: accepted event with wrong payload shape fails', () => {
    const event = {
      protocolVersion: '1.0',
      requestId: 'req-1', runId: 'run-1', sequence: 0,
      occurredAt: '2026-07-22T00:00:00.000Z',
      type: 'accepted',
      payload: { content: 'wrong shape for accepted' },
    }
    expect(SSEEventSchema.safeParse(event).success).toBe(false)
  })

  it('discriminated union: text-delta event with correct payload passes', () => {
    const event = {
      protocolVersion: '1.0',
      requestId: 'req-1', runId: 'run-1', sequence: 3,
      occurredAt: '2026-07-22T00:00:00.001Z',
      type: 'text-delta',
      payload: { content: '天地玄黄，宇宙洪荒。' },
    }
    expect(SSEEventSchema.safeParse(event).success).toBe(true)
  })

  it('discriminated union: text-delta with wrong payload shape fails', () => {
    const event = {
      protocolVersion: '1.0',
      requestId: 'req-1', runId: 'run-1', sequence: 3,
      occurredAt: '2026-07-22T00:00:00.001Z',
      type: 'text-delta',
      payload: { reply: 'wrong key' },
    }
    expect(SSEEventSchema.safeParse(event).success).toBe(false)
  })

  it('discriminated union: completed event with correct payload passes', () => {
    const event = {
      protocolVersion: '1.0',
      requestId: 'req-1', runId: 'run-1', sequence: 5,
      occurredAt: '2026-07-22T00:00:01.000Z',
      type: 'completed',
      payload: { reply: '修炼完成，你感到灵力充沛。' },
    }
    expect(SSEEventSchema.safeParse(event).success).toBe(true)
  })

  it('discriminated union: failed event with Problem Details passes', () => {
    const event = {
      protocolVersion: '1.0',
      requestId: 'req-1', runId: 'run-1', sequence: 4,
      occurredAt: '2026-07-22T00:00:00.500Z',
      type: 'failed',
      payload: {
        type: 'https://api.xiuxian.com/errors/llm-timeout',
        title: 'LLM Timeout', status: 504,
        detail: 'LLM call exceeded deadline.',
        code: 'LLM_TIMEOUT', requestId: 'req-1', retryable: true,
      },
    }
    expect(SSEEventSchema.safeParse(event).success).toBe(true)
  })

  it('discriminated union: cancelled event with correct payload passes', () => {
    const event = {
      protocolVersion: '1.0',
      requestId: 'req-1', runId: 'run-1', sequence: 4,
      occurredAt: '2026-07-22T00:00:00.500Z',
      type: 'cancelled',
      payload: { requestId: 'req-1', runId: 'run-1', reason: 'user cancelled' },
    }
    expect(SSEEventSchema.safeParse(event).success).toBe(true)
  })

  it('discriminated union: unknown event type fails', () => {
    const event = {
      protocolVersion: '1.0',
      requestId: 'req-1', runId: 'run-1', sequence: 0,
      occurredAt: '2026-07-22T00:00:00.000Z',
      type: 'nonexistent',
      payload: {},
    }
    expect(SSEEventSchema.safeParse(event).success).toBe(false)
  })
})

// ─── 2.1h: Inventory item JSON ───────────────────────────────────────────

describe('2.1h Inventory item schemas', () => {
  it('validates an inventory item', () => {
    expect(InventoryItemSchema.safeParse({
      id: 'item-1', name: '灵石', grade: '黄阶下品',
      type: 'currency', description: '修仙界通用货币', count: 100, value: 1,
    }).success).toBe(true)
  })

  it('rejects item with negative count', () => {
    expect(InventoryItemSchema.safeParse({
      id: 'x', name: 'x', grade: 'x', type: 'x', description: 'x', count: -1, value: 0,
    }).success).toBe(false)
  })
})
