import { describe, it, expect, beforeAll } from 'vitest'
import type { T1Npc } from '@/types'
import type { ConstraintRule } from '@/server/domain/region-dm'
import type { NpcTurnTrigger } from '@/server/application/npc-agent-loop'
import { getRegionRules } from '@/server/domain/region-dm'

// ── 辅助：构造测试NPC ────────────────────────────────────────────────────────

function makeNpc(overrides: Partial<T1Npc> = {}): T1Npc {
  return {
    id: 'npc-001',
    name: '王老四',
    title: '丹药铺店主',
    realm: '筑基后期',
    currentLocation: '青云坊市',
    alignment: '中立',
    sect: '散修',
    personality: '贪婪精明',
    relationship: 0,
    dialogueTemplates: {},
    description: '丹药铺老板。',
    createdAt: Date.now(),
    schedule: [
      { startHour: 6, endHour: 18, activity: '站柜营业', location: '青云坊市', interactable: true },
    ],
    knowledge: [],
    traits: { greed: 0.9, friendliness: 0.4, courage: 0.3, cunning: 0.8, lawfulness: 0.3, anger: 0.5 },
    archetype: 'merchant',
    ...overrides,
  }
}

function makeGuard(): T1Npc {
  return {
    id: 'npc-guard',
    name: '赵铁柱',
    title: '坊市守卫',
    realm: '金丹初期',
    currentLocation: '青云坊市',
    alignment: '正道',
    sect: '青云宗',
    personality: '刚正不阿',
    relationship: 0,
    dialogueTemplates: {},
    description: '坊市守卫。',
    createdAt: Date.now(),
    schedule: [
      { startHour: 6, endHour: 18, activity: '巡逻', location: '青云坊市', interactable: true },
    ],
    knowledge: [],
    traits: { greed: 0.2, friendliness: 0.3, courage: 0.8, cunning: 0.3, lawfulness: 0.9, anger: 0.6, vigilance: 0.85 },
    archetype: 'guard',
  }
}

function makeWanderer(): T1Npc {
  return {
    id: 'npc-wan',
    name: '李散修',
    realm: '练气后期',
    currentLocation: '青云坊市',
    alignment: '中立',
    sect: '散修',
    personality: '随和友善',
    relationship: 0,
    dialogueTemplates: {},
    description: '路过的散修。',
    createdAt: Date.now(),
    traits: { greed: 0.4, friendliness: 0.7, courage: 0.5, cunning: 0.3, lawfulness: 0.6, anger: 0.2, gossip: 0.8 },
    archetype: 'wanderer',
  }
}

function makeCraftsman(): T1Npc {
  return {
    id: 'npc-craft',
    name: '张铁匠',
    title: '铁匠铺老板',
    realm: '筑基中期',
    currentLocation: '青云坊市',
    alignment: '正道',
    sect: '散修',
    personality: '沉默寡言',
    relationship: 0,
    dialogueTemplates: {},
    description: '铁匠铺老板。',
    createdAt: Date.now(),
    schedule: [
      { startHour: 6, endHour: 18, activity: '锻造', location: '青云坊市', interactable: true },
    ],
    knowledge: [],
    traits: { greed: 0.2, friendliness: 0.3, courage: 0.6, cunning: 0.2, lawfulness: 0.8, anger: 0.3, craftsmanship: 0.85 },
    archetype: 'craftsman',
  }
}

// ── tickNpc 测试（动态导入，避免文件不存在时崩溃） ─────────────────────────

describe('tickNpc — NPC单次tick决策', () => {
  let tickNpc: typeof import('@/server/domain/npc-tick').tickNpc
  let formatSimpleAction: typeof import('@/server/domain/npc-tick').formatSimpleAction

  beforeAll(async () => {
    const mod = await import('@/server/domain/npc-tick')
    tickNpc = mod.tickNpc
    formatSimpleAction = mod.formatSimpleAction
  })

  it('导出tickNpc和formatSimpleAction函数', () => {
    expect(typeof tickNpc).toBe('function')
    expect(typeof formatSimpleAction).toBe('function')
  })

  it('商人在安全情境下→返回simple（不需要LLM）', () => {
    const npc = makeNpc()
    const allNpcs = [npc]
    const result = tickNpc(npc, allNpcs, hourToMs(12), false, 0, [])
    expect(result.kind).toBe('simple')
  })

  it('商人遇到玩家→返回llm_needed（需要LLM对话）', () => {
    const npc = makeNpc()
    const allNpcs = [npc]
    const result = tickNpc(npc, allNpcs, hourToMs(14), true, 0, [])
    expect(result.kind).toBe('llm_needed')
  })

  it('守卫在高威胁下→返回llm_needed（需要LLM决定战斗/逃跑）', () => {
    const npc = makeGuard()
    const allNpcs = [npc]
    const result = tickNpc(npc, allNpcs, hourToMs(14), true, 0.8, [])
    expect(result.kind).toBe('llm_needed')
    if (result.kind === 'llm_needed') {
      expect(result.trigger.type).toBe('threat_detected')
    }
  })

  it('夜间NPC→返回simple（rest不需要LLM）', () => {
    const npc = makeNpc()
    const allNpcs = [npc]
    const result = tickNpc(npc, allNpcs, hourToMs(3), false, 0, [])
    expect(result.kind).toBe('simple')
  })

  it('llm_needed结果包含正确的trigger', () => {
    const npc = makeNpc()
    const allNpcs = [npc]
    const result = tickNpc(npc, allNpcs, hourToMs(14), true, 0, [])
    expect(result.kind).toBe('llm_needed')
    if (result.kind === 'llm_needed') {
      expect(result.trigger).toBeDefined()
      expect(result.trigger.type).toBe('player_nearby')
    }
  })

  it('simple结果包含叙事文本', () => {
    const npc = makeCraftsman()
    const allNpcs = [npc]
    const result = tickNpc(npc, allNpcs, hourToMs(10), false, 0, [])
    expect(result.kind).toBe('simple')
    if (result.kind === 'simple') {
      expect(result.narrative).toBeDefined()
      expect(result.narrative.length).toBeGreaterThan(0)
    }
  })
})

// ── formatSimpleAction — 简单动作叙事 ──────────────────────────────────────

describe('formatSimpleAction — 简单动作→叙事文本', () => {
  let formatSimpleAction: typeof import('@/server/domain/npc-tick').formatSimpleAction

  beforeAll(async () => {
    const mod = await import('@/server/domain/npc-tick')
    formatSimpleAction = mod.formatSimpleAction
  })

  it('rest → 休息叙事', () => {
    const text = formatSimpleAction(makeNpc(), 'rest')
    expect(text.length).toBeGreaterThan(3)
  })

  it('wander → 闲逛叙事', () => {
    const text = formatSimpleAction(makeWanderer(), 'wander')
    expect(text.length).toBeGreaterThan(3)
  })

  it('patrol → 巡逻叙事', () => {
    const text = formatSimpleAction(makeGuard(), 'patrol')
    expect(text.length).toBeGreaterThan(3)
  })

  it('guard → 站岗叙事', () => {
    const text = formatSimpleAction(makeGuard(), 'guard')
    expect(text.length).toBeGreaterThan(3)
  })

  it('craft → 锻造叙事', () => {
    const text = formatSimpleAction(makeCraftsman(), 'craft')
    expect(text.length).toBeGreaterThan(3)
  })

  it('叙事文本包含NPC名称', () => {
    const text = formatSimpleAction(makeNpc(), 'rest')
    expect(text).toContain('王老四')
  })

  it('每个动作类型生成不同的叙事', () => {
    const guard = makeGuard()
    const texts = ['patrol', 'guard', 'rest'].map((t) =>
      formatSimpleAction(guard, t as 'patrol' | 'guard' | 'rest'),
    )
    const unique = new Set(texts)
    expect(unique.size).toBe(3)
  })
})

// ── tickRegionNpcs — 批量区域tick ─────────────────────────────────────────

describe('tickRegionNpcs — 批量区域NPC推进', () => {
  let tickRegionNpcs: typeof import('@/server/domain/npc-tick').tickRegionNpcs

  beforeAll(async () => {
    const mod = await import('@/server/domain/npc-tick')
    tickRegionNpcs = mod.tickRegionNpcs
  })

  it('批量tick返回更新后的NPC列表', async () => {
    const npcs = [makeNpc(), makeGuard()]
    const result = await tickRegionNpcs(npcs, npcs, hourToMs(12), 0, [])
    expect(result).toHaveLength(2)
  })

  it('所有返回的NPC仍是T1Npc类型', async () => {
    const npcs = [makeNpc()]
    const result = await tickRegionNpcs(npcs, npcs, hourToMs(12), 0, [])
    expect(result[0].id).toBe('npc-001')
    expect(result[0].name).toBe('王老四')
  })

  it('simple tick时NPC的知识气泡增长', async () => {
    const npc = makeNpc()
    npc.knowledge = []
    const result = await tickRegionNpcs([npc], [npc], hourToMs(12), 0, [])
    // simple tick应该有知识记录（NPC自己知道自己在做什么）
    expect(result[0].knowledge!.length).toBeGreaterThan(0)
  })

  it('空列表→返回空列表', async () => {
    const result = await tickRegionNpcs([], [], hourToMs(12), 0, [])
    expect(result).toHaveLength(0)
  })

  it('批量tick中每个NPC各自决策', async () => {
    const npcs = [makeNpc(), makeGuard(), makeWanderer()]
    const result = await tickRegionNpcs(npcs, npcs, hourToMs(14), 0, [])
    expect(result).toHaveLength(3)
    // simple动作的NPC应有知识记录，llm_needed的NPC知识由LLM回合完成后填充
    const knowledgeCounts = result.map((n) => n.knowledge!.length)
    // 至少有一个NPC（守卫，simple动作）有知识记录
    expect(knowledgeCounts.some((c) => c > 0)).toBe(true)
  })
})

// ── 集成场景 ───────────────────────────────────────────────────────────────

describe('集成场景 — NPC自治循环', () => {
  let tickNpc: typeof import('@/server/domain/npc-tick').tickNpc
  let tickRegionNpcs: typeof import('@/server/domain/npc-tick').tickRegionNpcs

  beforeAll(async () => {
    const mod = await import('@/server/domain/npc-tick')
    tickNpc = mod.tickNpc
    tickRegionNpcs = mod.tickRegionNpcs
  })

  it('坊市白天：商人→交易（llm_needed），守卫→巡逻（simple），散修→闲逛（simple）', () => {
    const merchant = makeNpc()
    const guard = makeGuard()
    const wanderer = makeWanderer()
    const allNpcs = [merchant, guard, wanderer]

    const mResult = tickNpc(merchant, allNpcs, hourToMs(14), true, 0, [])
    const gResult = tickNpc(guard, allNpcs, hourToMs(14), false, 0, [])
    const wResult = tickNpc(wanderer, allNpcs, hourToMs(14), false, 0, [])

    // 商人有玩家在附近→需要LLM对话
    expect(mResult.kind).toBe('llm_needed')
    // 守卫继续巡逻→简单动作
    expect(gResult.kind).toBe('simple')
    // 散修闲逛→简单动作
    expect(wResult.kind).toBe('simple')
  })

  it('坊市夜晚：所有NPC→rest（simple）', () => {
    const merchant = makeNpc()
    const guard = makeGuard()
    const wanderer = makeWanderer()
    const allNpcs = [merchant, guard, wanderer]

    const results = [merchant, guard, wanderer].map((npc) =>
      tickNpc(npc, allNpcs, hourToMs(3), false, 0, []),
    )

    // 夜间都应该休息（simple）
    expect(results.every((r) => r.kind === 'simple')).toBe(true)
  })

  it('魔修入侵：商人→flee（llm_needed），守卫→fight（llm_needed）', () => {
    const merchant = makeNpc()
    const guard = makeGuard()
    const allNpcs = [merchant, guard]

    const mResult = tickNpc(merchant, allNpcs, hourToMs(14), true, 0.9, [])
    const gResult = tickNpc(guard, allNpcs, hourToMs(14), true, 0.9, [])

    // 高威胁下都需要LLM来决策战斗/逃跑
    expect(mResult.kind).toBe('llm_needed')
    expect(gResult.kind).toBe('llm_needed')
  })

  it('批量tick后NPC的knowledge包含事件记录', async () => {
    const npc = makeNpc()
    npc.knowledge = []
    const result = await tickRegionNpcs([npc], [npc], hourToMs(10), 0, [])

    const knowledge = result[0].knowledge!
    expect(knowledge.length).toBeGreaterThan(0)
    expect(knowledge[0].eventType).toBeDefined()
    expect(knowledge[0].description).toBeDefined()
    expect(knowledge[0].location).toBe('青云坊市')
  })

  it('同区域NPC可以互相目击对方的行为', async () => {
    const merchant = makeNpc()
    const guard = makeGuard()
    merchant.knowledge = []
    guard.knowledge = []
    const npcs = [merchant, guard]

    const result = await tickRegionNpcs(npcs, npcs, hourToMs(10), 0, [])

    // 两个NPC都应该有知识记录（至少记录了自己的行为）
    expect(result[0].knowledge!.length).toBeGreaterThan(0)
    expect(result[1].knowledge!.length).toBeGreaterThan(0)
  })
})

// ── 辅助函数 ──────────────────────────────────────────────────────────────

function hourToMs(hour: number): number {
  const d = new Date()
  d.setHours(hour, 0, 0, 0)
  return d.getTime()
}
