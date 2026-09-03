// NPC决策层 — Utility AI评分系统
// 用性格参数+情境对所有可选动作连续打分，选最高分执行。零LLM成本。

// ── 类型定义 ────────────────────────────────────────────────────────────────

export type NpcActionType =
  | 'patrol'
  | 'trade'
  | 'craft'
  | 'wander'
  | 'fight'
  | 'flee'
  | 'dialogue'
  | 'rest'
  | 'guard'
  | 'bargain'
  | 'explore'
  | 'threaten'

export interface NpcParams {
  greed: number
  friendliness: number
  courage: number
  cunning: number
  lawfulness: number
  anger: number
  vigilance?: number
  gossip?: number
  craftsmanship?: number
}

export interface NpcDecisionContext {
  threatLevel: number
  playerNearby: boolean
  timeOfDay: number
  currentActivity: string
  locationName: string
}

export interface NpcAction {
  type: NpcActionType
  requiresLLM: boolean
  label: string
}

export interface NpcDecisionResult {
  action: NpcAction
  score: number
}

// ── 动作定义 ────────────────────────────────────────────────────────────────

interface ActionDef {
  type: NpcActionType
  baseScore: number
  requiresLLM: boolean
  label: string
  boosters: { param: keyof NpcParams; weight: number }[]
  dampeners: { param: keyof NpcParams; weight: number }[]
  contextMod: (ctx: NpcDecisionContext) => number
}

function isNight(hour: number): boolean {
  return hour < 6 || hour >= 22
}

function get(param: number | undefined, fallback: number): number {
  return param ?? fallback
}

const ACTION_DEFS: ActionDef[] = [
  {
    type: 'trade', baseScore: 0.45, requiresLLM: true, label: '交易',
    boosters: [{ param: 'greed', weight: 0.5 }],
    dampeners: [],
    contextMod: (ctx) => (ctx.playerNearby ? 0.1 : 0) - ctx.threatLevel * 0.5,
  },
  {
    type: 'guard', baseScore: 0.45, requiresLLM: false, label: '站岗',
    boosters: [
      { param: 'lawfulness', weight: 0.3 },
      { param: 'vigilance', weight: 0.3 },
    ],
    dampeners: [],
    contextMod: (ctx) => (ctx.threatLevel > 0.3 ? 0.1 : 0) - ctx.threatLevel * 0.5,
  },
  {
    type: 'craft', baseScore: 0.45, requiresLLM: false, label: '锻造',
    boosters: [{ param: 'craftsmanship', weight: 0.5 }],
    dampeners: [],
    contextMod: (ctx) => -ctx.threatLevel * 0.4,
  },
  {
    type: 'fight', baseScore: 0.05, requiresLLM: true, label: '战斗',
    boosters: [{ param: 'courage', weight: 0.7 }],
    dampeners: [],
    contextMod: (ctx) => ctx.threatLevel * 0.5,
  },
  {
    type: 'flee', baseScore: 0.3, requiresLLM: true, label: '逃跑',
    boosters: [],
    dampeners: [{ param: 'courage', weight: 0.5 }],
    contextMod: (ctx) => ctx.threatLevel * 0.8,
  },
  {
    type: 'threaten', baseScore: 0.2, requiresLLM: true, label: '威胁',
    boosters: [{ param: 'anger', weight: 0.5 }],
    dampeners: [{ param: 'lawfulness', weight: 0.5 }],
    contextMod: () => 0,
  },
  {
    type: 'bargain', baseScore: 0.15, requiresLLM: true, label: '讨价还价',
    boosters: [
      { param: 'greed', weight: 0.5 },
      { param: 'cunning', weight: 0.2 },
    ],
    dampeners: [],
    contextMod: (ctx) => -ctx.threatLevel * 0.4,
  },
  {
    type: 'dialogue', baseScore: 0.05, requiresLLM: true, label: '对话',
    boosters: [{ param: 'friendliness', weight: 0.7 }],
    dampeners: [],
    contextMod: (ctx) => (ctx.playerNearby ? 0.15 : 0) - ctx.threatLevel * 0.4,
  },
  {
    type: 'rest', baseScore: 0.2, requiresLLM: false, label: '休息',
    boosters: [],
    dampeners: [],
    contextMod: (ctx) => (isNight(ctx.timeOfDay) ? 0.4 : 0) - ctx.threatLevel * 0.3,
  },
  {
    type: 'wander', baseScore: 0.25, requiresLLM: false, label: '闲逛',
    boosters: [],
    dampeners: [],
    contextMod: (ctx) => -ctx.threatLevel * 0.3,
  },
  {
    type: 'patrol', baseScore: 0.35, requiresLLM: false, label: '巡逻',
    boosters: [
      { param: 'vigilance', weight: 0.4 },
      { param: 'lawfulness', weight: 0.2 },
    ],
    dampeners: [],
    contextMod: (ctx) => -ctx.threatLevel * 0.3,
  },
  {
    type: 'explore', baseScore: 0.3, requiresLLM: true, label: '探索',
    boosters: [
      { param: 'courage', weight: 0.3 },
      { param: 'cunning', weight: 0.15 },
    ],
    dampeners: [],
    contextMod: (ctx) => -ctx.threatLevel * 0.3,
  },
]

const DEF_MAP = new Map<NpcActionType, ActionDef>(
  ACTION_DEFS.map((d) => [d.type, d]),
)

// ── 按原型可用的动作 ────────────────────────────────────────────────────────

const ARCHETYPE_ACTIONS: Record<string, NpcActionType[]> = {
  merchant: ['trade', 'bargain', 'rest', 'wander', 'fight', 'flee', 'dialogue', 'threaten'],
  guard: ['patrol', 'guard', 'rest', 'wander', 'fight', 'flee', 'dialogue', 'threaten'],
  craftsman: ['craft', 'rest', 'wander', 'fight', 'flee', 'dialogue', 'threaten'],
  wanderer: ['explore', 'rest', 'wander', 'fight', 'flee', 'dialogue', 'threaten'],
}

// ── 公开API ─────────────────────────────────────────────────────────────────

export function getAvailableActions(archetypeId: string, _tier: number): NpcAction[] {
  const types = ARCHETYPE_ACTIONS[archetypeId] ?? ['rest', 'wander']
  return types.map((type) => {
    const def = DEF_MAP.get(type)!
    return { type: def.type, requiresLLM: def.requiresLLM, label: def.label }
  })
}

export function scoreAction(
  type: NpcActionType,
  params: NpcParams,
  context: NpcDecisionContext,
): number {
  const def = DEF_MAP.get(type)
  if (!def) return 0

  let raw = def.baseScore
  for (const b of def.boosters) {
    raw += get(params[b.param], 0) * b.weight
  }
  for (const d of def.dampeners) {
    raw -= get(params[d.param], 0) * d.weight
  }
  raw += def.contextMod(context)

  return Math.max(0, Math.min(1, raw))
}

export function decideNpcAction(
  params: NpcParams,
  archetypeId: string,
  context: NpcDecisionContext,
): NpcDecisionResult {
  const actions = getAvailableActions(archetypeId, 1)
  let best: { action: NpcAction; score: number } = {
    action: actions[0],
    score: -Infinity,
  }
  for (const action of actions) {
    const s = scoreAction(action.type, params, context)
    if (s > best.score) {
      best = { action, score: s }
    }
  }
  return { action: best.action, score: best.score }
}
