import { describe, it, expect, vi } from 'vitest'
import type {
  NpcTurnRequest,
  NpcTurnResult,
  NpcTurnDeps,
  NpcTurnTrigger,
} from '@/server/application/npc-agent-loop'
import { runNpcTurn } from '@/server/application/npc-agent-loop'
import type { T1Npc } from '@/types'
import type { ConstraintRule } from '@/server/domain/region-dm'
import type {
  LLMProvider,
  LLMResult,
  LLMRequest,
  LLMProviderConfig,
} from '@/server/infrastructure/dependency-ports'
import { getToolsForCaller, type ToolDefinition } from '@/server/contracts/tool-catalog'

// ── 辅助：构造测试NPC ────────────────────────────────────────────────────────

function makeTestNpc(overrides: Partial<T1Npc> = {}): T1Npc {
  return {
    id: 'npc-test-001',
    name: '王老四',
    title: '丹药铺店主',
    realm: '筑基后期',
    currentLocation: '青云坊市',
    alignment: '中立',
    sect: '散修',
    personality: '贪婪精明',
    relationship: 0,
    dialogueTemplates: {},
    description: '青云坊市丹药铺的老板，精于算计。',
    createdAt: Date.now(),
    schedule: [
      { startHour: 6, endHour: 18, activity: '站柜营业', location: '青云坊市', interactable: true },
    ],
    knowledge: [],
    traits: {
      greed: 0.9,
      friendliness: 0.4,
      courage: 0.3,
      cunning: 0.8,
      lawfulness: 0.3,
      anger: 0.5,
    },
    archetype: 'merchant',
    ...overrides,
  }
}

function makeGuardNpc(): T1Npc {
  return {
    id: 'npc-guard-001',
    name: '赵铁柱',
    title: '坊市守卫',
    realm: '金丹初期',
    currentLocation: '青云坊市',
    alignment: '正道',
    sect: '青云宗',
    personality: '刚正不阿',
    relationship: 0,
    dialogueTemplates: {},
    description: '青云坊市的巡逻守卫，铁面无私。',
    createdAt: Date.now(),
    schedule: [
      { startHour: 6, endHour: 18, activity: '巡逻', location: '青云坊市', interactable: true },
    ],
    knowledge: [],
    traits: {
      greed: 0.2,
      friendliness: 0.3,
      courage: 0.8,
      cunning: 0.3,
      lawfulness: 0.9,
      anger: 0.6,
      vigilance: 0.85,
    },
    archetype: 'guard',
  }
}

// ── 辅助：测试区域规则 ──────────────────────────────────────────────────────

const testRules: ConstraintRule[] = [
  { id: 'economic_fair_price', category: 'economic', text: '交易价格浮动不超过30%', defaultBound: true },
  { id: 'social_no_fight', category: 'social', text: '坊市内禁止私斗', defaultBound: true },
  { id: 'economic_no_steal', category: 'economic', text: '禁止偷窃抢劫', defaultBound: true },
]

// ── 辅助：NPC列表 ────────────────────────────────────────────────────────────

const allNpcs: T1Npc[] = [
  makeTestNpc(),
  makeGuardNpc(),
  {
    id: 'npc-wanderer-001',
    name: '李散修',
    realm: '练气后期',
    currentLocation: '青云坊市',
    alignment: '中立',
    sect: '散修',
    personality: '随和友善',
    relationship: 0,
    dialogueTemplates: {},
    description: '一个路过的散修。',
    createdAt: Date.now(),
    traits: { greed: 0.4, friendliness: 0.8, courage: 0.5, cunning: 0.3, lawfulness: 0.6, anger: 0.2, gossip: 0.8 },
    archetype: 'wanderer',
  },
]

// ── 辅助：fake LLM ───────────────────────────────────────────────────────────

function makeFakeLlm(
  handler: (request: LLMRequest) => LLMResult,
): LLMProvider {
  return {
    complete: vi.fn().mockImplementation(
      (_config: LLMProviderConfig, request: LLMRequest) => Promise.resolve(handler(request)),
    ),
  }
}

function makeTextResponse(content: string): LLMResult {
  return {
    ok: true,
    response: {
      id: 'resp-1',
      content,
      toolCalls: [],
      finishReason: 'stop',
    },
  }
}

function makeToolCallResponse(
  toolName: string,
  args: Record<string, unknown>,
  content?: string,
): LLMResult {
  return {
    ok: true,
    response: {
      id: 'resp-2',
      content: content ?? null,
      toolCalls: [
        {
          id: 'call-1',
          name: toolName,
          arguments: args,
        },
      ],
      finishReason: 'tool_calls',
    },
  }
}

// ── 辅助：fake deps ─────────────────────────────────────────────────────────

function makeDeps(llm: LLMProvider): NpcTurnDeps {
  return {
    llmProvider: llm,
    clock: { now: () => Date.now(), iso: () => new Date().toISOString(), deadline: (ms) => Date.now() + ms },
    idGen: { requestId: () => 'req-1', runId: () => 'run-1', idempotencyKey: () => 'idem-1', uuid: () => 'uuid-1' },
  }
}

// ── 测试：核心函数签名 + 类型导出 ───────────────────────────────────────────

describe('NPC Agent Loop — 类型与导出', () => {
  it('导出runNpcTurn函数', () => {
    expect(typeof runNpcTurn).toBe('function')
  })
})

// ── 测试：工具过滤 ──────────────────────────────────────────────────────────

describe('NPC工具目录', () => {
  it('llm_npc角色恰好获得11个工具（6感知+5行为）', () => {
    const tools = getToolsForCaller('llm_npc')
    expect(tools).toHaveLength(11)
    const perceptionTools = tools.filter((t) => t.category === 'perception_query')
    const behaviorTools = tools.filter((t) => t.category === 'npc_behavior')
    expect(perceptionTools).toHaveLength(6)
    expect(behaviorTools).toHaveLength(5)
  })

  it('NPC工具不包含任何world_action工具', () => {
    const tools = getToolsForCaller('llm_npc')
    const worldActions = tools.filter((t) => t.category === 'world_action')
    expect(worldActions).toHaveLength(0)
  })

  it('NPC工具包含必要的感知工具', () => {
    const tools = getToolsForCaller('llm_npc')
    const names = tools.map((t) => t.name)
    expect(names).toContain('LookAround')
    expect(names).toContain('SearchArea')
    expect(names).toContain('SenseDanger')
    expect(names).toContain('CheckNpcState')
    expect(names).toContain('RecallMemory')
    expect(names).toContain('ExamineObject')
  })

  it('NPC工具包含必要的行为工具', () => {
    const tools = getToolsForCaller('llm_npc')
    const names = tools.map((t) => t.name)
    expect(names).toContain('DecideReaction')
    expect(names).toContain('GenerateDialogue')
    expect(names).toContain('FormMemory')
    expect(names).toContain('GenerateDailyPlan')
    expect(names).toContain('SelfReflection')
  })
})

// ── 测试：简单LLM调用（无工具） ─────────────────────────────────────────────

describe('runNpcTurn — 简单反应（无工具调用）', () => {
  it('商人遇到玩家→直接返回对话文本', async () => {
    const npc = makeTestNpc()
    const fakeLlm = makeFakeLlm(() =>
      makeTextResponse('客官要点什么？本店丹药都是上品。'),
    )
    const deps = makeDeps(fakeLlm)
    const request: NpcTurnRequest = {
      npc,
      trigger: { type: 'player_nearby', description: '一位修士走进丹药铺' },
      regionRules: testRules,
      allNpcs,
      gameTimeMs: Date.now(),
      llmConfig: { apiKey: 'test', baseUrl: 'http://test', modelName: 'test' },
    }

    const result = await runNpcTurn(deps, request)

    expect(result.dialogue).toBeDefined()
    expect(result.dialogue!.length).toBeGreaterThan(0)
    expect(result.npc.id).toBe(npc.id)
    expect(fakeLlm.complete).toHaveBeenCalledTimes(1)
  })

  it('守卫遇到威胁→返回反应（非对话）', async () => {
    const npc = makeGuardNpc()
    const fakeLlm = makeFakeLlm(() =>
      makeTextResponse('守卫警觉地握紧武器，目光锁定来者。'),
    )
    const deps = makeDeps(fakeLlm)
    const request: NpcTurnRequest = {
      npc,
      trigger: { type: 'threat_detected', description: '魔修闯入坊市', threatLevel: 0.9 },
      regionRules: testRules,
      allNpcs,
      gameTimeMs: Date.now(),
      llmConfig: { apiKey: 'test', baseUrl: 'http://test', modelName: 'test' },
    }

    const result = await runNpcTurn(deps, request)

    expect(result.actionNarrative).toBeDefined()
  })
})

// ── 测试：LLM工具调用 → FormMemory ─────────────────────────────────────────

describe('runNpcTurn — 工具调用', () => {
  it('NPC使用FormMemory形成记忆', async () => {
    const npc = makeTestNpc()
    // 第一次调用：决定生成对话 + 形成记忆
    const calls: LLMRequest[] = []
    const fakeLlm: LLMProvider = {
      complete: vi.fn().mockImplementation(
        async (_config: LLMProviderConfig, request: LLMRequest): Promise<LLMResult> => {
          calls.push(request)
          if (calls.length === 1) {
            return makeToolCallResponse('FormMemory', {
              content: '一个年轻修士进门打听筑基丹的价格',
              importance: 0.6,
            })
          }
          return makeTextResponse('客官要买筑基丹？正好店里还有两枚。')
        },
      ),
    }
    const deps = makeDeps(fakeLlm)
    const request: NpcTurnRequest = {
      npc: { ...npc, knowledge: [] },
      trigger: { type: 'player_dialogue', dialogueInput: '老板，有筑基丹吗？' },
      regionRules: testRules,
      allNpcs,
      gameTimeMs: Date.now(),
      llmConfig: { apiKey: 'test', baseUrl: 'http://test', modelName: 'test' },
    }

    const result = await runNpcTurn(deps, request)

    expect(fakeLlm.complete).toHaveBeenCalledTimes(2)
    expect(result.memoriesFormed.length).toBeGreaterThan(0)
    expect(result.npc.knowledge!.length).toBeGreaterThan(0)
  })

  it('NPC使用LookAround感知环境后再回应', async () => {
    const npc = makeTestNpc()
    const calls: LLMRequest[] = []
    const fakeLlm: LLMProvider = {
      complete: vi.fn().mockImplementation(
        async (_config: LLMProviderConfig, request: LLMRequest): Promise<LLMResult> => {
          calls.push(request)
          if (calls.length === 1) {
            return makeToolCallResponse('LookAround', {})
          }
          return makeTextResponse('（环顾四周后）今天生意不错，坊市人挺多。')
        },
      ),
    }
    const deps = makeDeps(fakeLlm)
    const request: NpcTurnRequest = {
      npc,
      trigger: { type: 'scheduled_action', description: 'NPC继续进行日常营业' } as NpcTurnTrigger,
      regionRules: testRules,
      allNpcs,
      gameTimeMs: Date.now(),
      llmConfig: { apiKey: 'test', baseUrl: 'http://test', modelName: 'test' },
    }

    const result = await runNpcTurn(deps, request)

    expect(fakeLlm.complete).toHaveBeenCalledTimes(2)
    expect(result.actionNarrative).toBeDefined()
  })
})

// ── 测试：系统提示内容 ─────────────────────────────────────────────────────

describe('系统提示验证', () => {
  it('NPC系统提示包含角色身份信息', async () => {
    const npc = makeTestNpc()
    let systemPrompt = ''
    const fakeLlm: LLMProvider = {
      complete: vi.fn().mockImplementation(
        async (_config: LLMProviderConfig, request: LLMRequest): Promise<LLMResult> => {
          systemPrompt = (request.messages[0]?.content as string) ?? ''
          return makeTextResponse('好。')
        },
      ),
    }
    const deps = makeDeps(fakeLlm)
    const request: NpcTurnRequest = {
      npc,
      trigger: { type: 'player_nearby', description: '一位修士走来' },
      regionRules: testRules,
      allNpcs,
      gameTimeMs: Date.now(),
      llmConfig: { apiKey: 'test', baseUrl: 'http://test', modelName: 'test' },
    }

    await runNpcTurn(deps, request)

    expect(systemPrompt).toContain('王老四')
    expect(systemPrompt).toContain('丹药铺店主')
    expect(systemPrompt).toContain('筑基后期')
    expect(systemPrompt).toContain('贪婪精明')
  })

  it('NPC系统提示包含区域约束规则', async () => {
    const npc = makeTestNpc()
    let systemPrompt = ''
    const fakeLlm: LLMProvider = {
      complete: vi.fn().mockImplementation(
        async (_config: LLMProviderConfig, request: LLMRequest): Promise<LLMResult> => {
          systemPrompt = (request.messages[0]?.content as string) ?? ''
          return makeTextResponse('好。')
        },
      ),
    }
    const deps = makeDeps(fakeLlm)
    const request: NpcTurnRequest = {
      npc,
      trigger: { type: 'player_nearby', description: '一位修士走来' },
      regionRules: testRules,
      allNpcs,
      gameTimeMs: Date.now(),
      llmConfig: { apiKey: 'test', baseUrl: 'http://test', modelName: 'test' },
    }

    await runNpcTurn(deps, request)

    // NPC系统提示应包含约束规则区域
    expect(systemPrompt).toMatch(/规则|约束|遵守/)
  })

  it('NPC系统提示不含GM身份用语', async () => {
    const npc = makeTestNpc()
    let systemPrompt = ''
    const fakeLlm: LLMProvider = {
      complete: vi.fn().mockImplementation(
        async (_config: LLMProviderConfig, request: LLMRequest): Promise<LLMResult> => {
          systemPrompt = (request.messages[0]?.content as string) ?? ''
          return makeTextResponse('好。')
        },
      ),
    }
    const deps = makeDeps(fakeLlm)
    const request: NpcTurnRequest = {
      npc,
      trigger: { type: 'player_nearby', description: '一位修士走来' },
      regionRules: testRules,
      allNpcs,
      gameTimeMs: Date.now(),
      llmConfig: { apiKey: 'test', baseUrl: 'http://test', modelName: 'test' },
    }

    await runNpcTurn(deps, request)

    expect(systemPrompt).not.toContain('世界运转者')
    expect(systemPrompt).not.toContain('game_master')
    expect(systemPrompt).not.toContain('GM')
  })

  it('NPC系统提示包含性格参数', async () => {
    const npc = makeTestNpc()
    let systemPrompt = ''
    const fakeLlm: LLMProvider = {
      complete: vi.fn().mockImplementation(
        async (_config: LLMProviderConfig, request: LLMRequest): Promise<LLMResult> => {
          systemPrompt = (request.messages[0]?.content as string) ?? ''
          return makeTextResponse('好。')
        },
      ),
    }
    const deps = makeDeps(fakeLlm)
    const request: NpcTurnRequest = {
      npc,
      trigger: { type: 'player_nearby', description: '一位修士走来' },
      regionRules: testRules,
      allNpcs,
      gameTimeMs: Date.now(),
      llmConfig: { apiKey: 'test', baseUrl: 'http://test', modelName: 'test' },
    }

    await runNpcTurn(deps, request)

    // 应包含性格参数或原型信息
    expect(systemPrompt).toMatch(/贪婪|greed|merchant|商人/)
  })

  it('NPC系统提示包含位置和在场人物', async () => {
    const npc = makeTestNpc()
    let systemPrompt = ''
    const fakeLlm: LLMProvider = {
      complete: vi.fn().mockImplementation(
        async (_config: LLMProviderConfig, request: LLMRequest): Promise<LLMResult> => {
          systemPrompt = (request.messages[0]?.content as string) ?? ''
          return makeTextResponse('好。')
        },
      ),
    }
    const deps = makeDeps(fakeLlm)
    const request: NpcTurnRequest = {
      npc,
      trigger: { type: 'player_nearby', description: '一位修士走来' },
      regionRules: testRules,
      allNpcs,
      gameTimeMs: Date.now(),
      llmConfig: { apiKey: 'test', baseUrl: 'http://test', modelName: 'test' },
    }

    await runNpcTurn(deps, request)

    expect(systemPrompt).toContain('青云坊市')
  })
})

// ── 测试：错误处理 ─────────────────────────────────────────────────────────

describe('错误处理', () => {
  it('LLM返回错误时runNpcTurn抛出', async () => {
    const npc = makeTestNpc()
    const fakeLlm: LLMProvider = {
      complete: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: 'AUTH_ERROR', message: 'Invalid API key', retryable: false },
      }),
    }
    const deps = makeDeps(fakeLlm)
    const request: NpcTurnRequest = {
      npc,
      trigger: { type: 'player_nearby', description: '一位修士走来' },
      regionRules: testRules,
      allNpcs,
      gameTimeMs: Date.now(),
      llmConfig: { apiKey: 'test', baseUrl: 'http://test', modelName: 'test' },
    }

    await expect(runNpcTurn(deps, request)).rejects.toThrow()
  })

  it('AbortSignal取消时抛出', async () => {
    const npc = makeTestNpc()
    const controller = new AbortController()
    const fakeLlm: LLMProvider = {
      complete: vi.fn().mockImplementation(async () => {
        controller.abort()
        throw new Error('Aborted')
      }),
    }
    const deps = makeDeps(fakeLlm)
    const request: NpcTurnRequest = {
      npc,
      trigger: { type: 'player_nearby', description: '一位修士走来' },
      regionRules: testRules,
      allNpcs,
      gameTimeMs: Date.now(),
      llmConfig: { apiKey: 'test', baseUrl: 'http://test', modelName: 'test' },
      signal: controller.signal,
    }

    await expect(runNpcTurn(deps, request)).rejects.toThrow()
  })
})

// ── 测试：结果结构 ─────────────────────────────────────────────────────────

describe('runNpcTurn — 结果结构', () => {
  it('返回结果包含npc（更新后的引用）', async () => {
    const npc = makeTestNpc()
    const fakeLlm = makeFakeLlm(() => makeTextResponse('客官请。'))
    const deps = makeDeps(fakeLlm)
    const request: NpcTurnRequest = {
      npc,
      trigger: { type: 'player_nearby', description: '修士进店' },
      regionRules: testRules,
      allNpcs,
      gameTimeMs: Date.now(),
      llmConfig: { apiKey: 'test', baseUrl: 'http://test', modelName: 'test' },
    }

    const result = await runNpcTurn(deps, request)

    expect(result.npc).toBeDefined()
    expect(result.npc.id).toBe(npc.id)
  })

  it('返回结果包含actionType', async () => {
    const npc = makeTestNpc()
    const fakeLlm = makeFakeLlm(() => makeTextResponse('客官。'))
    const deps = makeDeps(fakeLlm)
    const request: NpcTurnRequest = {
      npc,
      trigger: { type: 'player_nearby', description: '修士进店' },
      regionRules: testRules,
      allNpcs,
      gameTimeMs: Date.now(),
      llmConfig: { apiKey: 'test', baseUrl: 'http://test', modelName: 'test' },
    }

    const result = await runNpcTurn(deps, request)

    expect(result.actionType).toBeDefined()
    expect(typeof result.actionType).toBe('string')
  })
})

// ── 测试：不同触发器类型 ───────────────────────────────────────────────────

describe('runNpcTurn — 触发器类型', () => {
  it('player_dialogue触发器→NPC以对话回应', async () => {
    const npc = makeTestNpc()
    const fakeLlm = makeFakeLlm(() =>
      makeTextResponse('筑基丹一百灵石一枚，不二价。'),
    )
    const deps = makeDeps(fakeLlm)
    const request: NpcTurnRequest = {
      npc,
      trigger: { type: 'player_dialogue', dialogueInput: '筑基丹怎么卖？' },
      regionRules: testRules,
      allNpcs,
      gameTimeMs: Date.now(),
      llmConfig: { apiKey: 'test', baseUrl: 'http://test', modelName: 'test' },
    }

    const result = await runNpcTurn(deps, request)

    expect(result.dialogue).toBeDefined()
  })

  it('event_witness触发器→NPC目击事件', async () => {
    const npc = makeTestNpc()
    const fakeLlm = makeFakeLlm(() =>
      makeTextResponse('（王老四目睹争执，暗暗记下这两人面孔）'),
    )
    const deps = makeDeps(fakeLlm)
    const request: NpcTurnRequest = {
      npc,
      trigger: { type: 'event_witness', description: '两个修士在丹药铺门口争吵' },
      regionRules: testRules,
      allNpcs,
      gameTimeMs: Date.now(),
      llmConfig: { apiKey: 'test', baseUrl: 'http://test', modelName: 'test' },
    }

    const result = await runNpcTurn(deps, request)

    expect(result.actionNarrative).toBeDefined()
  })

  it('player_nearby触发器→NPC注意到玩家', async () => {
    const npc = makeTestNpc()
    const fakeLlm = makeFakeLlm(() =>
      makeTextResponse('王老四抬眼看了看进门的修士。'),
    )
    const deps = makeDeps(fakeLlm)
    const request: NpcTurnRequest = {
      npc,
      trigger: { type: 'player_nearby', description: '一位筑基期修士走进丹药铺' },
      regionRules: testRules,
      allNpcs,
      gameTimeMs: Date.now(),
      llmConfig: { apiKey: 'test', baseUrl: 'http://test', modelName: 'test' },
    }

    const result = await runNpcTurn(deps, request)

    expect(result.actionNarrative || result.dialogue).toBeDefined()
  })
})

// ── 测试：业务场景 ──────────────────────────────────────────────────────────

describe('业务场景 — 模拟真实NPC交互', () => {
  it('王老四对砍价玩家的反应（商人+高greed）', async () => {
    const npc = makeTestNpc()
    const fakeLlm = makeFakeLlm(() =>
      makeTextResponse('（皱眉）筑基丹这价已经是最低了，客官要是嫌贵可以去别家看看。'),
    )
    const deps = makeDeps(fakeLlm)
    const request: NpcTurnRequest = {
      npc,
      trigger: { type: 'player_dialogue', dialogueInput: '筑基丹能不能便宜点？五十灵石卖不卖？' },
      regionRules: testRules,
      allNpcs,
      gameTimeMs: Date.now(),
      llmConfig: { apiKey: 'test', baseUrl: 'http://test', modelName: 'test' },
    }

    const result = await runNpcTurn(deps, request)

    expect(result.dialogue).toBeDefined()
    expect(result.dialogue!.length).toBeGreaterThan(5)
  })

  it('守卫对挑衅玩家的反应（高courage+高lawfulness）', async () => {
    const npc = makeGuardNpc()
    const fakeLlm = makeFakeLlm(() =>
      makeTextResponse('（手按刀柄）坊市之内禁止闹事，阁下请自重。'),
    )
    const deps = makeDeps(fakeLlm)
    const request: NpcTurnRequest = {
      npc,
      trigger: { type: 'player_dialogue', dialogueInput: '你算什么东西？敢拦我？' },
      regionRules: testRules,
      allNpcs,
      gameTimeMs: Date.now(),
      llmConfig: { apiKey: 'test', baseUrl: 'http://test', modelName: 'test' },
    }

    const result = await runNpcTurn(deps, request)

    expect(result.dialogue).toBeDefined()
  })

  it('守卫目击私斗→立即反应', async () => {
    const npc = makeGuardNpc()
    const fakeLlm = makeFakeLlm(() =>
      makeTextResponse('赵铁柱拔刀冲向斗殴者：住手！坊市禁止私斗！'),
    )
    const deps = makeDeps(fakeLlm)
    const request: NpcTurnRequest = {
      npc,
      trigger: { type: 'event_witness', description: '两名修士在坊市中心大打出手' },
      regionRules: testRules,
      allNpcs,
      gameTimeMs: Date.now(),
      llmConfig: { apiKey: 'test', baseUrl: 'http://test', modelName: 'test' },
    }

    const result = await runNpcTurn(deps, request)

    expect(result.actionNarrative).toBeDefined()
    expect(result.actionNarrative!.length).toBeGreaterThan(5)
  })
})
