import { describe, it, expect } from 'vitest'
import {
  scoreAction,
  decideNpcAction,
  getAvailableActions,
  type NpcActionType,
  type NpcDecisionContext,
  type NpcParams,
} from '@/server/domain/npc-decision'

// ── 辅助：标准NPC参数 ────────────────────────────────────────────────────

const merchantParams: NpcParams = {
  greed: 0.9,
  friendliness: 0.4,
  courage: 0.3,
  cunning: 0.8,
  lawfulness: 0.3,
  anger: 0.4,
}

const guardParams: NpcParams = {
  greed: 0.2,
  friendliness: 0.3,
  courage: 0.8,
  cunning: 0.3,
  lawfulness: 0.9,
  anger: 0.6,
  vigilance: 0.85,
}

const wandererParams: NpcParams = {
  greed: 0.4,
  friendliness: 0.7,
  courage: 0.5,
  cunning: 0.3,
  lawfulness: 0.6,
  anger: 0.2,
  gossip: 0.8,
}

const craftsmanParams: NpcParams = {
  greed: 0.2,
  friendliness: 0.3,
  courage: 0.5,
  cunning: 0.2,
  lawfulness: 0.8,
  anger: 0.3,
  craftsmanship: 0.85,
}

const safeContext: NpcDecisionContext = {
  threatLevel: 0,
  playerNearby: false,
  timeOfDay: 12,
  currentActivity: '营业',
  locationName: '青云坊市',
}

const threatContext: NpcDecisionContext = {
  threatLevel: 0.8,
  playerNearby: true,
  timeOfDay: 12,
  currentActivity: '巡逻',
  locationName: '青云坊市',
}

// ── getAvailableActions — NPC按等级和情境可用的动作 ─────────────────────

describe('getAvailableActions — 可选动作池', () => {
  it('所有NPC都有休息和闲逛', () => {
    const actions = getAvailableActions('merchant', 1)
    const types = actions.map((a) => a.type)
    expect(types).toContain('rest')
    expect(types).toContain('wander')
  })

  it('商人在安全情境下可以交易', () => {
    const actions = getAvailableActions('merchant', 1)
    const types = actions.map((a) => a.type)
    expect(types).toContain('trade')
    expect(types).toContain('bargain')
  })

  it('守卫可以巡逻和站岗', () => {
    const actions = getAvailableActions('guard', 1)
    const types = actions.map((a) => a.type)
    expect(types).toContain('patrol')
    expect(types).toContain('guard')
  })

  it('匠人可以锻造', () => {
    const actions = getAvailableActions('craftsman', 1)
    const types = actions.map((a) => a.type)
    expect(types).toContain('craft')
  })

  it('散修可以探索', () => {
    const actions = getAvailableActions('wanderer', 1)
    const types = actions.map((a) => a.type)
    expect(types).toContain('explore')
  })

  it('有威胁时所有人都可以战斗和逃跑', () => {
    const actions = getAvailableActions('merchant', 1)
    const types = actions.map((a) => a.type)
    expect(types).toContain('fight')
    expect(types).toContain('flee')
  })

  it('低lawfulness NPC可以威胁', () => {
    const actions = getAvailableActions('merchant', 1)
    const types = actions.map((a) => a.type)
    // 威胁对所有人都开放（但lawfulness高的人会得低分）
    expect(types).toContain('threaten')
  })

  it('玩家附近时开启对话选项', () => {
    const actions = getAvailableActions('merchant', 1)
    const types = actions.map((a) => a.type)
    expect(types).toContain('dialogue')
  })
})

// ── scoreAction — 单项动作效用评分 ─────────────────────────────────────

describe('scoreAction — 单项动作效用评分', () => {
  it('商人（greed=0.9）→ trade得分高', () => {
    const score = scoreAction('trade', merchantParams, safeContext)
    expect(score).toBeGreaterThan(0.5)
  })

  it('守卫（lawfulness=0.9）→ guard得分高', () => {
    const score = scoreAction('guard', guardParams, safeContext)
    expect(score).toBeGreaterThan(0.5)
  })

  it('匠人（craftsmanship=0.85）→ craft得分高', () => {
    const score = scoreAction('craft', craftsmanParams, safeContext)
    expect(score).toBeGreaterThan(0.5)
  })

  it('低courage=0.3 → fight得分低', () => {
    const score = scoreAction('fight', merchantParams, safeContext)
    expect(score).toBeLessThan(0.4)
  })

  it('高courage=0.8 → fight得分高', () => {
    const score = scoreAction('fight', guardParams, safeContext)
    expect(score).toBeGreaterThan(0.4)
  })

  it('有威胁时 → flee得分提升', () => {
    const safe = scoreAction('flee', merchantParams, safeContext)
    const danger = scoreAction('flee', merchantParams, threatContext)
    expect(danger).toBeGreaterThan(safe)
  })

  it('有威胁时 → fight得分提升', () => {
    const safe = scoreAction('fight', guardParams, safeContext)
    const danger = scoreAction('fight', guardParams, threatContext)
    expect(danger).toBeGreaterThan(safe)
  })

  it('高lawfulness=0.9 → threaten得分极低', () => {
    const score = scoreAction('threaten', guardParams, safeContext)
    expect(score).toBeLessThan(0.2)
  })

  it('低lawfulness=0.3 + 高anger=0.7 → threaten得分高', () => {
    const angryParams = { ...merchantParams, anger: 0.7, lawfulness: 0.2 }
    const score = scoreAction('threaten', angryParams, safeContext)
    expect(score).toBeGreaterThan(0.4)
  })

  it('高greed → bargain得分高', () => {
    const score = scoreAction('bargain', merchantParams, safeContext)
    expect(score).toBeGreaterThan(0.5)
  })

  it('低greed → bargain得分低', () => {
    const lowGreed = { ...craftsmanParams, greed: 0.1 }
    const score = scoreAction('bargain', lowGreed, safeContext)
    expect(score).toBeLessThan(0.3)
  })

  it('高friendliness → dialogue得分高', () => {
    const score = scoreAction('dialogue', wandererParams, safeContext)
    expect(score).toBeGreaterThan(0.5)
  })

  it('低friendliness → dialogue得分低', () => {
    const score = scoreAction('dialogue', guardParams, safeContext)
    expect(score).toBeLessThan(0.35)
  })

  it('夜间 → rest得分提升', () => {
    const dayCtx = { ...safeContext, timeOfDay: 12 }
    const nightCtx = { ...safeContext, timeOfDay: 2 }
    const dayScore = scoreAction('rest', wandererParams, dayCtx)
    const nightScore = scoreAction('rest', wandererParams, nightCtx)
    expect(nightScore).toBeGreaterThan(dayScore)
  })

  it('所有得分在0-1范围内', () => {
    const allTypes: NpcActionType[] = [
      'patrol', 'trade', 'craft', 'wander', 'fight', 'flee',
      'dialogue', 'rest', 'guard', 'bargain', 'explore', 'threaten',
    ]
    for (const type of allTypes) {
      const score = scoreAction(type, wandererParams, safeContext)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    }
  })
})

// ── decideNpcAction — 综合决策 ──────────────────────────────────────────

describe('decideNpcAction — 综合决策', () => {
  it('安全情境下商人倾向trade', () => {
    const result = decideNpcAction(merchantParams, 'merchant', safeContext)
    expect(result.action.type).toBe('trade')
    expect(result.score).toBeGreaterThan(0.5)
  })

  it('有威胁时低courage NPC倾向flee', () => {
    const result = decideNpcAction(merchantParams, 'merchant', threatContext)
    // 商人 courage=0.3，威胁下应选 flee
    expect(result.action.type).toBe('flee')
  })

  it('有威胁时高courage NPC倾向fight', () => {
    const result = decideNpcAction(guardParams, 'guard', threatContext)
    // 守卫 courage=0.8，威胁下应选 fight
    expect(result.action.type).toBe('fight')
  })

  it('返回的决策包含分数和是否需要LLM', () => {
    const result = decideNpcAction(merchantParams, 'merchant', safeContext)
    expect(typeof result.score).toBe('number')
    expect(typeof result.action.requiresLLM).toBe('boolean')
  })

  it('复杂动作标记requiresLLM=true', () => {
    // dialogue requires LLM
    const dialogueCtx: NpcDecisionContext = {
      ...safeContext,
      playerNearby: true,
      currentActivity: '闲聊',
    }
    const result = decideNpcAction(wandererParams, 'wanderer', dialogueCtx)
    expect(result.action.requiresLLM).toBe(true)
  })

  it('简单动作标记requiresLLM=false', () => {
    // rest doesn't need LLM
    const nightCtx = { ...safeContext, timeOfDay: 2 }
    const result = decideNpcAction(wandererParams, 'wanderer', nightCtx)
    expect(result.action.requiresLLM).toBe(false)
  })

  it('夜间NPC倾向rest', () => {
    const nightCtx = { ...safeContext, timeOfDay: 3 }
    const result = decideNpcAction(wandererParams, 'wanderer', nightCtx)
    expect(result.action.type).toBe('rest')
  })

  it('相同参数+相同情境 → 相同决策（确定性）', () => {
    const a = decideNpcAction(merchantParams, 'merchant', safeContext)
    const b = decideNpcAction(merchantParams, 'merchant', safeContext)
    expect(a.action.type).toBe(b.action.type)
    expect(a.score).toBe(b.score)
  })

  it('不同参数 → 可能不同决策', () => {
    const a = decideNpcAction(merchantParams, 'merchant', threatContext)
    const b = decideNpcAction(guardParams, 'guard', threatContext)
    // 商人和守卫在威胁下决策不同
    expect(a.action.type).not.toBe(b.action.type)
  })

  it('散修在安全情境下倾向wander或explore', () => {
    const result = decideNpcAction(wandererParams, 'wanderer', safeContext)
    expect(['wander', 'explore', 'dialogue']).toContain(result.action.type)
  })

  it('匠人在安全情境下倾向craft', () => {
    const result = decideNpcAction(craftsmanParams, 'craftsman', safeContext)
    expect(result.action.type).toBe('craft')
  })

  it('边界：无可用动作时fallback到rest', () => {
    // 所有NPC都有rest，这个不应该触发，但防御性编程
    const weirdParams = { ...merchantParams, greed: 0, courage: 0, lawfulness: 1 }
    const result = decideNpcAction(weirdParams, 'merchant', safeContext)
    expect(result.action.type).toBeDefined()
  })
})

// ── 业务场景测试 ────────────────────────────────────────────────────────

describe('业务场景 — 模拟真实NPC决策', () => {
  it('王老四（greedy merchant）在坊市营业中 → trade', () => {
    const wangParams: NpcParams = {
      greed: 0.9, friendliness: 0.4, courage: 0.3,
      cunning: 0.8, lawfulness: 0.3, anger: 0.5,
    }
    const ctx: NpcDecisionContext = {
      threatLevel: 0,
      playerNearby: true,
      timeOfDay: 14,
      currentActivity: '营业',
      locationName: '青云坊市',
    }
    const result = decideNpcAction(wangParams, 'merchant', ctx)
    expect(result.action.type).toBe('trade')
  })

  it('张铁匠（lawful craftsman）在坊市锻造中 → craft', () => {
    const zhangParams: NpcParams = {
      greed: 0.2, friendliness: 0.3, courage: 0.6,
      cunning: 0.2, lawfulness: 0.8, anger: 0.3,
      craftsmanship: 0.85,
    }
    const ctx: NpcDecisionContext = {
      threatLevel: 0,
      playerNearby: false,
      timeOfDay: 10,
      currentActivity: '锻造',
      locationName: '青云坊市',
    }
    const result = decideNpcAction(zhangParams, 'craftsman', ctx)
    expect(result.action.type).toBe('craft')
  })

  it('李散修（friendly wanderer）在坊市闲逛中遇到玩家 → dialogue', () => {
    const liParams: NpcParams = {
      greed: 0.4, friendliness: 0.7, courage: 0.5,
      cunning: 0.3, lawfulness: 0.6, anger: 0.2,
      gossip: 0.8,
    }
    const ctx: NpcDecisionContext = {
      threatLevel: 0,
      playerNearby: true,
      timeOfDay: 15,
      currentActivity: '逛街淘宝',
      locationName: '青云坊市',
    }
    const result = decideNpcAction(liParams, 'wanderer', ctx)
    expect(result.action.type).toBe('dialogue')
  })

  it('守卫遇到魔修（高威胁）→ fight', () => {
    const ctx: NpcDecisionContext = {
      threatLevel: 0.9,
      playerNearby: true,
      timeOfDay: 20,
      currentActivity: '巡逻',
      locationName: '青云坊市',
    }
    const result = decideNpcAction(guardParams, 'guard', ctx)
    expect(result.action.type).toBe('fight')
  })

  it('商人遇到魔修（高威胁但courage低）→ flee', () => {
    const ctx: NpcDecisionContext = {
      threatLevel: 0.9,
      playerNearby: true,
      timeOfDay: 20,
      currentActivity: '营业',
      locationName: '青云坊市',
    }
    const result = decideNpcAction(merchantParams, 'merchant', ctx)
    expect(result.action.type).toBe('flee')
  })
})
