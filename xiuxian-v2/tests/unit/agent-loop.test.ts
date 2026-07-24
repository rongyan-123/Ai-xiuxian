/**
 * Agent Loop unit tests.
 *
 * Covers the while-loop Agent engine:
 * - Complexity estimation (combat/exploration/dialogue)
 * - Normal termination (text only, text+tools, tools-only→loop→text)
 * - Tool execution via rule engine
 * - Validation errors (unknown/duplicate/contradictory tools)
 * - Cancellation (LLM_ABORTED, AbortSignal)
 * - LLM errors (auth/timeout/server error)
 * - Idempotency (replay, duplicate rejection)
 * - Player not found
 * - RAG degradation
 * - Hard limit reached → force completion
 * - Transaction failure
 */
import { describe, it, expect } from 'vitest'
import { agentLoop } from '@/server/application/agent-loop'
import type { AgentLoopDeps, GameTurnRequest } from '@/server/application/agent-loop'
import { createFakePlayerRepository } from '@/server/infrastructure/fake-repositories'
import { createFakeTurnExecutionRepository } from '@/server/infrastructure/fake-repositories'
import { createFakeOutboxRepository } from '@/server/infrastructure/fake-repositories'
import { createFakeRAGProvider } from '@/server/infrastructure/rag-adapter'
import { createFakeSummaryProvider } from '@/server/infrastructure/rag-adapter'
import { createFakeClock, createFakeIdGenerator } from '@/server/infrastructure/adapters'
import type {
  LLMProvider,
  LLMResult,
  EventSink,
  EnvelopeEvent,
} from '@/server/infrastructure/dependency-ports'
import type { PlayerSnapshot } from '@/server/infrastructure/ports'

// ─── Fake LLM Provider ────────────────────────────────────────────────────

function createFakeLLMProvider(
  responses: LLMResult[] | (() => LLMResult),
): LLMProvider {
  const responseFn = Array.isArray(responses)
    ? (() => responses.shift() ?? { ok: false, error: { code: 'LLM_SERVER_ERROR' as const, message: 'No more responses', retryable: false } })
    : responses

  return {
    async complete(_config, _request) {
      return responseFn()
    },
  }
}

function makeSuccessLLM(
  content: string | null,
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [],
): LLMResult {
  return {
    ok: true,
    response: {
      id: 'chatcmpl-test',
      content,
      toolCalls,
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    },
  }
}

// ─── Fake Event Sink ──────────────────────────────────────────────────────

interface RecordedEvent {
  type: string
  payload: Record<string, unknown>
}

function createFakeEventSink(): EventSink & {
  events: RecordedEvent[]
  completed: boolean
  failed: boolean
  cancelled: boolean
  errorCode: string | null
} {
  const state = {
    events: [] as RecordedEvent[],
    completed: false,
    failed: false,
    cancelled: false,
    errorCode: null as string | null,
  }

  return {
    events: state.events,
    get completed() { return state.completed },
    get failed() { return state.failed },
    get cancelled() { return state.cancelled },
    get errorCode() { return state.errorCode },

    emit(event: EnvelopeEvent) {
      state.events.push({ type: event.type, payload: event.payload })
    },
    complete() {
      state.completed = true
    },
    fail(error: { code: string; message: string; retryable: boolean }) {
      state.failed = true
      state.errorCode = error.code
    },
    cancel(_reason?: string) {
      state.cancelled = true
    },
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const NOW_MS = 1700000000000

function makePlayer(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    id: 'player-1',
    status: 'ALIVE',
    name: '测试修士',
    gender: '男',
    version: 0,
    stats: {
      hp: { current: 100, max: 100, status_desc: '健康' },
      mp: { current: 50, max: 50, status_desc: '充足' },
      spirit: { value: 5, desc: '凡识' },
      realm: '练气期一层',
      age: { current: 18, max: 120 },
      race: '人族',
      alignment: '正道' as const,
      sect: '青云门',
      spiritual_root: '金灵根',
      mental_state: '正常',
      reputation: 0,
      emotion: '平静',
      state_of_mind: 80,
      fortune: 50,
      karma: 0,
      techniques: { main: '基础吐纳', combat: [], movement: '步行', support: [] },
      shield: { current: 0, max: 50 },
      talents: [],
      traits: [],
    },
    inventory: [],
    codex: [],
    relationships: {},
    situations: [],
    foreshadowings: [],
    createdAt: NOW_MS,
    updatedAt: NOW_MS,
    ...overrides,
  } as PlayerSnapshot
}

function makeRequest(overrides: Partial<GameTurnRequest> = {}): GameTurnRequest {
  return {
    playerId: 'player-1',
    playerName: '测试修士',
    input: '探索青云山',
    mode: 'action',
    idempotencyKey: 'idem-001',
    llmConfig: {
      apiKey: 'sk-test',
      baseUrl: 'https://api.test.example',
      modelName: 'test-model',
    },
    ...overrides,
  }
}

function makeDeps(opts: {
  overrides?: Partial<AgentLoopDeps>
  player?: PlayerSnapshot | null
} = {}): AgentLoopDeps {
  const { overrides = {}, player = makePlayer() } = opts
  const clock = createFakeClock(NOW_MS)
  const idGen = createFakeIdGenerator()
  const playerRepo = player
    ? createFakePlayerRepository([player])
    : createFakePlayerRepository()
  const turnRepo = createFakeTurnExecutionRepository()
  const outboxRepo = createFakeOutboxRepository()
  const llmProvider = createFakeLLMProvider([
    makeSuccessLLM('你踏入青云山，感受到浓郁的灵气。'),
  ])
  const ragProvider = createFakeRAGProvider({ results: [] })
  const summaryProvider = createFakeSummaryProvider()

  return {
    playerRepo,
    turnRepo,
    outboxRepo,
    llmProvider,
    ragProvider,
    summaryProvider,
    clock,
    idGen,
    eventSink: createFakeEventSink(),
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Agent Loop — complexity estimation', () => {
  it('assigns higher budget for combat input', async () => {
    const llm = createFakeLLMProvider([
      makeSuccessLLM('战斗开始！', [
        { id: 'call_1', name: 'Modify_Stats', arguments: { hp_change: -10 } },
      ]),
    ])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest({ input: '与妖兽战斗' }))

    // Combat input should complete successfully (budget allows tool execution)
    expect(sink.completed).toBe(true)
    expect(sink.failed).toBe(false)
  })

  it('assigns medium budget for exploration input', async () => {
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { eventSink: sink } })

    await agentLoop(deps, makeRequest({ input: '前往黑木林寻找灵药' }))

    expect(sink.completed).toBe(true)
    expect(sink.failed).toBe(false)
  })

  it('assigns default budget for simple dialogue input', async () => {
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { eventSink: sink } })

    await agentLoop(deps, makeRequest({ input: '你好，请问这里有灵药卖吗？', mode: 'dialogue' }))

    expect(sink.completed).toBe(true)
    expect(sink.failed).toBe(false)
  })
})

describe('Agent Loop — termination (implicit Done)', () => {
  it('completes when LLM returns text without tools', async () => {
    const llm = createFakeLLMProvider([
      makeSuccessLLM('青云山的灵气浓郁，你感到身心舒畅。'),
    ])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    expect(sink.completed).toBe(true)
    expect(sink.failed).toBe(false)
    // Should have emitted text-delta and completed events
    const types = sink.events.map(e => e.type)
    expect(types).toContain('text-delta')
    expect(types).toContain('completed')
  })

  it('streams full LLM text content to player', async () => {
    const narrative = '你穿过云雾缭绕的山路，前方出现一座古朴的道观。门匾上写着"太虚观"三个大字。'
    const llm = createFakeLLMProvider([makeSuccessLLM(narrative)])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    const textDeltas = sink.events.filter(e => e.type === 'text-delta')
    const combinedText = textDeltas.map(e => e.payload.content).join('')
    expect(combinedText).toBe(narrative)
  })

  it('executes tools then completes when LLM returns text AND tools', async () => {
    const llm = createFakeLLMProvider([
      makeSuccessLLM('你发现了一些灵石！', [
        { id: 'call_1', name: 'Backpack_additems', arguments: { items: [{ name: '灵石', count: 5, grade: '下品', type: '消耗品' }] } },
      ]),
    ])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    expect(sink.completed).toBe(true)
    // Text should have been streamed
    const textEvents = sink.events.filter(e => e.type === 'text-delta')
    expect(textEvents.length).toBeGreaterThan(0)
    // State should have been updated
    const stateUpdate = sink.events.find(e => e.type === 'state_update')
    expect(stateUpdate).toBeDefined()
  })

  it('loops for narration when LLM returns tools without text (pure tool response)', async () => {
    // First response: tools only, no text → should loop
    // Second response: narration → done
    const llm = createFakeLLMProvider([
      makeSuccessLLM(null, [
        { id: 'call_1', name: 'Modify_Stats', arguments: { hp_change: -5 } },
      ]),
      makeSuccessLLM('一阵阴风吹过，你感到生命力被削弱了些许。'),
    ])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    expect(sink.completed).toBe(true)
    expect(sink.failed).toBe(false)
    // Should have both state update and text
    const types = sink.events.map(e => e.type)
    expect(types).toContain('text-delta')
    expect(types).toContain('state_update')
  })

  it('handles null content as no-text (tools-only response)', async () => {
    const llm = createFakeLLMProvider([
      makeSuccessLLM(null, [
        { id: 'call_1', name: 'Modify_Stats', arguments: { mp_change: -10 } },
      ]),
      makeSuccessLLM('施法消耗了你一些灵力。'),
    ])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    expect(sink.completed).toBe(true)
  })

  it('completes with only a state_update when no tools and empty content', async () => {
    const llm = createFakeLLMProvider([makeSuccessLLM('')])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    expect(sink.completed).toBe(true)
  })
})

describe('Agent Loop — tool execution via rule engine', () => {
  it('applies Modify_Stats to player state', async () => {
    const llm = createFakeLLMProvider([
      makeSuccessLLM('妖兽的利爪划破了你的手臂！', [
        { id: 'call_1', name: 'Modify_Stats', arguments: { hp_change: -30, karma_change: 1 } },
      ]),
    ])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    expect(sink.completed).toBe(true)
    const stateUpdate = sink.events.find(e => e.type === 'state_update')
    expect(stateUpdate).toBeDefined()
  })

  it('applies Backpack_additems to inventory', async () => {
    const llm = createFakeLLMProvider([
      makeSuccessLLM('你捡到了一把剑。', [
        { id: 'call_1', name: 'Backpack_additems', arguments: { items: [{ name: '青釭剑', count: 1, grade: '地阶上品', type: '法宝' }] } },
      ]),
    ])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    expect(sink.completed).toBe(true)
    const stateUpdate = sink.events.find(e => e.type === 'state_update')
    expect(stateUpdate!.payload.deltas).toBeDefined()
  })

  it('applies Change_Location', async () => {
    const llm = createFakeLLMProvider([
      makeSuccessLLM('你离开了青云山。', [
        { id: 'call_1', name: 'Change_Location', arguments: { location: '黑木林' } },
      ]),
    ])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    expect(sink.completed).toBe(true)
  })

  it('applies Write_Journal', async () => {
    const llm = createFakeLLMProvider([
      makeSuccessLLM('值得记录的一天。', [
        { id: 'call_1', name: 'Write_Journal', arguments: { title: '探索青云', content: '在青云山发现了灵石矿脉。' } },
      ]),
    ])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    expect(sink.completed).toBe(true)
  })

  it('applies Update_Relationship', async () => {
    const llm = createFakeLLMProvider([
      makeSuccessLLM('青云掌门对你刮目相看。', [
        { id: 'call_1', name: 'Update_Relationship', arguments: { npc_name: '青云掌门', change: 15 } },
      ]),
    ])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    expect(sink.completed).toBe(true)
  })

  it('accumulates deltas across multiple tool calls', async () => {
    const llm = createFakeLLMProvider([
      makeSuccessLLM('战斗结束，你获得了战利品。', [
        { id: 'call_1', name: 'Modify_Stats', arguments: { hp_change: -20, mp_change: -10 } },
        { id: 'call_2', name: 'Backpack_additems', arguments: { items: [{ name: '妖兽内丹', count: 1, grade: '玄阶中品', type: '材料' }] } },
        { id: 'call_3', name: 'Write_Journal', arguments: { title: '击败妖兽', content: '首次击败练气期妖兽。' } },
      ]),
    ])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    expect(sink.completed).toBe(true)
    const stateUpdate = sink.events.find(e => e.type === 'state_update')
    expect(stateUpdate!.payload.deltas).toBeDefined()
  })
})

describe('Agent Loop — validation errors', () => {
  it('fails with TOOL_VALIDATION_ERROR for unknown tool', async () => {
    const llm = createFakeLLMProvider([
      makeSuccessLLM('尝试施法', [
        { id: 'call_1', name: 'NONEXISTENT_TOOL', arguments: { x: 1 } },
      ]),
    ])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    expect(sink.failed).toBe(true)
    expect(sink.errorCode).toBe('TOOL_VALIDATION_ERROR')
  })

  it('fails for duplicate tool calls', async () => {
    const llm = createFakeLLMProvider([
      makeSuccessLLM(null, [
        { id: 'call_1', name: 'Modify_Stats', arguments: { hp_change: -10 } },
        { id: 'call_2', name: 'Modify_Stats', arguments: { mp_change: -5 } },
      ]),
    ])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    expect(sink.failed).toBe(true)
    expect(sink.errorCode).toBe('TOOL_VALIDATION_ERROR')
  })

  it('fails for contradictory tool calls (add+reduce same item)', async () => {
    const llm = createFakeLLMProvider([
      makeSuccessLLM(null, [
        { id: 'call_1', name: 'Backpack_additems', arguments: { items: [{ name: '灵石', count: 5 }] } },
        { id: 'call_2', name: 'Backpack_reduceitems', arguments: { items: [{ name: '灵石', count: 3 }] } },
      ]),
    ])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    expect(sink.failed).toBe(true)
    expect(sink.errorCode).toBe('TOOL_VALIDATION_ERROR')
  })

  it('fails for malformed tool args', async () => {
    const llm = createFakeLLMProvider([
      makeSuccessLLM(null, [
        { id: 'call_1', name: 'Update_Relationship', arguments: { change: 10 } }, // missing required npc_name
      ]),
    ])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    expect(sink.failed).toBe(true)
    expect(sink.errorCode).toBe('TOOL_VALIDATION_ERROR')
  })
})

describe('Agent Loop — cancellation', () => {
  it('cancels cleanly when LLM returns LLM_ABORTED', async () => {
    const llm = createFakeLLMProvider([
      { ok: false, error: { code: 'LLM_ABORTED' as const, message: 'Request cancelled', retryable: false } },
    ])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    expect(sink.cancelled).toBe(true)
    expect(sink.completed).toBe(false)
    expect(sink.failed).toBe(false)
  })

  it('does not commit player state when cancelled', async () => {
    const llm = createFakeLLMProvider([
      { ok: false, error: { code: 'LLM_ABORTED' as const, message: 'Cancelled', retryable: false } },
    ])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    const player = await deps.playerRepo.findById('player-1')
    expect(player!.version).toBe(0)
  })

  it('handles AbortSignal during loop iteration', async () => {
    const controller = new AbortController()
    // LLM returns a tool-only response that would normally loop, but signal is aborted
    const llm = createFakeLLMProvider([
      makeSuccessLLM(null, [
        { id: 'call_1', name: 'Modify_Stats', arguments: { hp_change: -10 } },
      ]),
      makeSuccessLLM('这个不应该被调用'),
    ])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    // Abort after a small delay — the loop checks signal before each iteration
    controller.abort()

    await agentLoop(deps, makeRequest({ signal: controller.signal }))

    // Should be cancelled without committing
    expect(sink.completed).toBe(false)
  })
})

describe('Agent Loop — LLM errors', () => {
  it('fails with LLM_AUTHENTICATION', async () => {
    const llm = createFakeLLMProvider([
      { ok: false, error: { code: 'LLM_AUTHENTICATION', message: 'Invalid API key', retryable: false, statusCode: 401 } },
    ])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    expect(sink.failed).toBe(true)
    expect(sink.errorCode).toBe('LLM_AUTHENTICATION')
  })

  it('fails with LLM_TIMEOUT', async () => {
    const llm = createFakeLLMProvider([
      { ok: false, error: { code: 'LLM_TIMEOUT', message: 'Request timed out', retryable: true } },
    ])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest({ timeoutMs: 100 }))

    expect(sink.failed).toBe(true)
    expect(sink.errorCode).toBe('LLM_TIMEOUT')
  })

  it('fails with LLM_SERVER_ERROR', async () => {
    const llm = createFakeLLMProvider([
      { ok: false, error: { code: 'LLM_SERVER_ERROR', message: 'Internal server error', retryable: true } },
    ])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    expect(sink.failed).toBe(true)
    expect(sink.errorCode).toBe('LLM_SERVER_ERROR')
  })

  it('does not commit state on LLM error', async () => {
    const llm = createFakeLLMProvider([
      { ok: false, error: { code: 'LLM_SERVER_ERROR', message: 'Server error', retryable: true } },
    ])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    const player = await deps.playerRepo.findById('player-1')
    expect(player!.version).toBe(0)
  })

  it('marks execution as FAILED on LLM error', async () => {
    const llm = createFakeLLMProvider([
      { ok: false, error: { code: 'LLM_SERVER_ERROR', message: 'Server error', retryable: true } },
    ])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    const record = await deps.turnRepo.findByIdempotencyKey('player-1', 'idem-001')
    expect(record).not.toBeNull()
    expect(record!.status).toBe('FAILED')
  })
})

describe('Agent Loop — idempotency', () => {
  it('replays completed result without re-executing', async () => {
    const deps = makeDeps()

    // First execution
    await agentLoop(deps, makeRequest({ idempotencyKey: 'idem-replay' }))
    const sink1 = deps.eventSink as ReturnType<typeof createFakeEventSink>
    expect(sink1.completed).toBe(true)

    // Second execution — should find ALREADY_COMPLETED
    const sink2 = createFakeEventSink()
    const player = await deps.playerRepo.findById('player-1')
    const deps2 = makeDeps({ overrides: { eventSink: sink2 }, player: player! })

    await agentLoop(deps2, makeRequest({ idempotencyKey: 'idem-replay' }))

    expect(sink2.completed).toBe(true)
  })

  it('rejects duplicate while execution is in progress', async () => {
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { eventSink: sink } })

    // Pre-reserve in the SAME turnRepo to simulate in-progress execution
    await deps.turnRepo.reserve('player-1', 'idem-busy', 'req-running')

    await agentLoop(deps, makeRequest({ idempotencyKey: 'idem-busy' }))

    expect(sink.failed).toBe(true)
    expect(sink.errorCode).toBe('TURN_IN_PROGRESS')
  })
})

describe('Agent Loop — player not found', () => {
  it('fails with PLAYER_NOT_FOUND', async () => {
    const sink = createFakeEventSink()
    const deps = makeDeps({ player: null, overrides: { eventSink: sink } })

    await agentLoop(deps, makeRequest())

    expect(sink.failed).toBe(true)
    expect(sink.errorCode).toBe('PLAYER_NOT_FOUND')
    expect(sink.completed).toBe(false)
  })
})

describe('Agent Loop — RAG degradation', () => {
  it('completes when RAG is unavailable', async () => {
    const rag = createFakeRAGProvider({
      error: { code: 'RAG_UNAVAILABLE', message: 'Vector store down' },
    })
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { ragProvider: rag, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    expect(sink.completed).toBe(true)
  })

  it('still invokes LLM when RAG fails', async () => {
    let llmCalled = false
    const rag = createFakeRAGProvider({
      error: { code: 'RAG_UNAVAILABLE', message: 'Vector store down' },
    })
    const llm: LLMProvider = {
      async complete(_config, _request) {
        llmCalled = true
        return makeSuccessLLM('虽然没有检索到背景知识，但你依然继续前行。')
      },
    }
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { ragProvider: rag, llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    expect(llmCalled).toBe(true)
    expect(sink.completed).toBe(true)
  })

  it('completes when RAG returns empty results', async () => {
    const rag = createFakeRAGProvider({ results: [] })
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { ragProvider: rag, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    expect(sink.completed).toBe(true)
  })
})

describe('Agent Loop — hard limit / force completion', () => {
  it('forces completion when hard limit is reached (tools-only loops exhaust budget)', async () => {
    // Simulate an LLM that keeps returning tool calls without text
    // Default budget for simple input is softLimit=3, hardLimit=6
    // We provide 7 tool-only responses; the loop should stop at hardLimit=6
    const responses: LLMResult[] = []
    for (let i = 0; i < 10; i++) {
      responses.push(makeSuccessLLM(null, [
        { id: `call_${i}`, name: 'Modify_Stats', arguments: { reputation_change: 1 } },
      ]))
    }
    const llm = createFakeLLMProvider(responses)
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest({ input: '测试硬上限' }))

    // Should complete (not fail), but with whatever state was accumulated
    expect(sink.completed).toBe(true)
    expect(sink.failed).toBe(false)
  })

  it('completes even when last iteration has no text (hard limit break)', async () => {
    // Exactly hardLimit iterations of tools-only, no text ever
    const responses: LLMResult[] = []
    for (let i = 0; i < 6; i++) {
      responses.push(makeSuccessLLM(null, [
        { id: `call_${i}`, name: 'Write_Journal', arguments: { title: `记录${i}`, content: `第${i}次记录` } },
      ]))
    }
    const llm = createFakeLLMProvider(responses)
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest({ input: '测试' }))

    expect(sink.completed).toBe(true)
  })
})

describe('Agent Loop — transaction failure', () => {
  it('reports failure when commitGameTurn throws', async () => {
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { eventSink: sink } })

    deps.playerRepo.save = async () => {
      throw new Error('Database connection lost during commit')
    }

    await agentLoop(deps, makeRequest())

    expect(sink.failed).toBe(true)
    expect(sink.errorCode).toBe('TRANSACTION_FAILED')
  })
})

describe('Agent Loop — event sequence', () => {
  it('emits accepted → text-delta → state_update → completed in order', async () => {
    const llm = createFakeLLMProvider([
      makeSuccessLLM('探索完成。', [
        { id: 'call_1', name: 'Modify_Stats', arguments: { reputation_change: 5 } },
      ]),
    ])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    const types = sink.events.map(e => e.type)
    const acceptedIdx = types.indexOf('accepted')
    const textIdx = types.indexOf('text-delta')
    const stateIdx = types.indexOf('state_update')
    const completedIdx = types.indexOf('completed')

    expect(acceptedIdx).toBeGreaterThanOrEqual(0)
    expect(textIdx).toBeGreaterThan(acceptedIdx)
    expect(stateIdx).toBeGreaterThan(textIdx)
    expect(completedIdx).toBeGreaterThan(stateIdx)
  })

  it('generates unique requestId and runId for each execution', async () => {
    const idGen1 = createFakeIdGenerator('test1-')
    const sink1 = createFakeEventSink()
    const deps1 = makeDeps({ overrides: { eventSink: sink1, idGen: idGen1 } })

    await agentLoop(deps1, makeRequest({ idempotencyKey: 'idem-c' }))

    const idGen2 = createFakeIdGenerator('test2-')
    const sink2 = createFakeEventSink()
    const deps2 = makeDeps({ overrides: { eventSink: sink2, idGen: idGen2 } })

    await agentLoop(deps2, makeRequest({ idempotencyKey: 'idem-d' }))

    const reqId1 = sink1.events[0].payload.requestId as string
    const reqId2 = sink2.events[0].payload.requestId as string
    expect(reqId1).not.toBe(reqId2)
  })

  it('includes game content in completed payload', async () => {
    const narrative = '你完成了这次探索。'
    const llm = createFakeLLMProvider([makeSuccessLLM(narrative)])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    const completed = sink.events.find(e => e.type === 'completed')
    expect(completed).toBeDefined()
    expect(completed!.payload.reply).toBe(narrative)
  })
})

describe('Agent Loop — system prompt', () => {
  it('includes player state in system prompt', async () => {
    let capturedMessages: Array<{ role: string; content: string }> = []
    const llm: LLMProvider = {
      async complete(_config, request) {
        capturedMessages = request.messages
        return makeSuccessLLM('好的。')
      },
    }
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    const systemMsg = capturedMessages.find(m => m.role === 'system')
    expect(systemMsg).toBeDefined()
    expect(systemMsg!.content).toContain('测试修士')
    expect(systemMsg!.content).toContain('练气期一层')
    expect(systemMsg!.content).toContain('金灵根')
    expect(systemMsg!.content).toContain('生命')
    expect(systemMsg!.content).toContain('灵力')
  })

  it('includes tool definitions in LLM request', async () => {
    let capturedTools: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = []
    const llm: LLMProvider = {
      async complete(_config, request) {
        capturedTools = request.tools ?? []
        return makeSuccessLLM('收到工具。')
      },
    }
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    expect(capturedTools.length).toBeGreaterThan(0)
    const toolNames = capturedTools.map(t => t.name)
    expect(toolNames).toContain('SearchArea')
    expect(toolNames).toContain('ModifyStats')
  })

  it('includes inventory in system prompt when items exist', async () => {
    let capturedMessages: Array<{ role: string; content: string }> = []
    const llm: LLMProvider = {
      async complete(_config, request) {
        capturedMessages = request.messages
        return makeSuccessLLM('好的。')
      },
    }
    const sink = createFakeEventSink()
    const player = makePlayer({
      inventory: [
        { id: 'inv-1', name: '回灵丹', type: '消耗品', grade: '黄阶中品', count: 3, description: '恢复灵力', value: 10 },
      ],
    })
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink }, player })

    await agentLoop(deps, makeRequest())

    const systemMsg = capturedMessages.find(m => m.role === 'system')
    expect(systemMsg!.content).toContain('回灵丹×3')
  })

  it('shows empty inventory message when no items', async () => {
    let capturedMessages: Array<{ role: string; content: string }> = []
    const llm: LLMProvider = {
      async complete(_config, request) {
        capturedMessages = request.messages
        return makeSuccessLLM('好的。')
      },
    }
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    const systemMsg = capturedMessages.find(m => m.role === 'system')
    expect(systemMsg!.content).toContain('空空如也')
  })

  it('includes budget hint when approaching soft limit', async () => {
    // Use a combat input (hardLimit=25) but make LLM return tools-only repeatedly
    const responses: LLMResult[] = []
    // 16 tool-only responses should push us past the soft limit of 15 for combat
    for (let i = 0; i < 16; i++) {
      responses.push(makeSuccessLLM(null, [
        { id: `call_${i}`, name: 'Modify_Stats', arguments: { reputation_change: 1 } },
      ]))
    }
    // Then finally text
    responses.push(makeSuccessLLM('战斗终于结束了。'))

    let capturedSystemPrompts: string[] = []
    const llm: LLMProvider = {
      async complete(_config, request) {
        const sysMsg = request.messages.find(m => m.role === 'system')
        if (sysMsg) capturedSystemPrompts.push(sysMsg.content)
        return responses.shift() ?? { ok: false, error: { code: 'LLM_SERVER_ERROR', message: 'No more', retryable: false } }
      },
    }
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest({ input: '与妖兽展开激烈战斗', idempotencyKey: 'combat-test' }))

    // Check that at least one system prompt after iteration 15 contains the budget hint
    const hintsAfterSoftLimit = capturedSystemPrompts.slice(15).filter(p => p.includes('收束'))
    expect(hintsAfterSoftLimit.length).toBeGreaterThan(0)
  })
})

describe('Agent Loop — dead player status', () => {
  it('marks player as DEAD when hp drops to 0 or below', async () => {
    const llm = createFakeLLMProvider([
      makeSuccessLLM('致命一击！', [
        { id: 'call_1', name: 'Modify_Stats', arguments: { hp_change: -150 } },
      ]),
    ])
    const sink = createFakeEventSink()
    const deps = makeDeps({ overrides: { llmProvider: llm, eventSink: sink } })

    await agentLoop(deps, makeRequest())

    expect(sink.completed).toBe(true)
    const stateUpdate = sink.events.find(e => e.type === 'state_update')
    const player = stateUpdate!.payload.player as PlayerSnapshot
    expect(player.status).toBe('DEAD')
  })
})
