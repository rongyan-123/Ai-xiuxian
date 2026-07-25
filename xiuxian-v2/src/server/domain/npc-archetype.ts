/**
 * NPC原型系统 — GTA V式"原型+随机参数=个体"
 *
 * 每个原型定义行为池、对话风格、参数范围。
 * 创建NPC时在参数范围内随机roll，使同原型NPC产生个体差异。
 */
import type { T1Npc } from '@/types'

// ── 原型定义 ─────────────────────────────────────────────────────────────────

export interface ParamRange {
  min: number
  max: number
}

export interface NpcArchetype {
  id: string
  name: string                    // 中文名："商人"
  /** 此原型NPC可选的行为列表 */
  behaviorPool: string[]
  /** 默认对话风格（LLM prompt注入用） */
  defaultDialogueStyle: string
  /** 各参数取值范围 [min, max]，保留一位小数 */
  paramRanges: Record<string, ParamRange>
}

export interface NpcParams {
  [paramName: string]: number
}

/** 从种子创建NPC时的参数覆盖 */
export interface NpcParamOverrides {
  /** 指定确定性随机种子，使同NPC每次roll结果一致 */
  seed?: string
  /** 覆盖特定参数值（如种子NPC可指定王老四greed=0.8） */
  overrides?: Partial<NpcParams>
}

// ── 四个原型 ─────────────────────────────────────────────────────────────────

export const ARCHETYPES: Record<string, NpcArchetype> = {
  merchant: {
    id: 'merchant',
    name: '商人',
    behaviorPool: ['站柜营业', '进货', '讨价还价', '盘点账目', '收摊关门', '午间用饭'],
    defaultDialogueStyle: '客官要什么？',
    paramRanges: {
      greed:       { min: 0.3, max: 0.9 },   // 贪婪 — 影响定价
      friendliness: { min: 0.3, max: 0.8 },   // 友善
      courage:     { min: 0.1, max: 0.5 },   // 胆量
      cunning:     { min: 0.4, max: 0.9 },   // 狡诈
      lawfulness:  { min: 0.2, max: 0.9 },   // 守法度 — 影响约束遵守
      anger:       { min: 0.2, max: 0.7 },   // 愤怒
    },
  },

  wanderer: {
    id: 'wanderer',
    name: '散修',
    behaviorPool: ['逛街淘宝', '茶楼歇息', '接任务', '出城修炼', '闲聊', '摆摊'],
    defaultDialogueStyle: '道友有何指教？',
    paramRanges: {
      greed:       { min: 0.2, max: 0.7 },
      friendliness: { min: 0.4, max: 0.9 },
      courage:     { min: 0.3, max: 0.7 },
      cunning:     { min: 0.2, max: 0.6 },
      lawfulness:  { min: 0.3, max: 0.8 },
      anger:       { min: 0.1, max: 0.5 },
      gossip:      { min: 0.3, max: 0.9 },   // 八卦 — 影响信息传播概率
    },
  },

  craftsman: {
    id: 'craftsman',
    name: '匠人',
    behaviorPool: ['锻造', '开炉备料', '收工整理', '休息', '练剑自修'],
    defaultDialogueStyle: '要打什么？',
    paramRanges: {
      greed:        { min: 0.1, max: 0.5 },
      friendliness:  { min: 0.1, max: 0.5 },
      courage:      { min: 0.4, max: 0.7 },
      craftsmanship: { min: 0.5, max: 0.95 }, // 工艺 — 影响装备品质
      lawfulness:   { min: 0.4, max: 0.9 },
      anger:        { min: 0.2, max: 0.6 },
    },
  },

  guard: {
    id: 'guard',
    name: '守卫',
    behaviorPool: ['巡逻', '站岗', '盘查询问', '换岗休息', '警戒'],
    defaultDialogueStyle: '站住，干什么的？',
    paramRanges: {
      greed:       { min: 0.1, max: 0.6 },
      friendliness: { min: 0.2, max: 0.5 },
      courage:     { min: 0.5, max: 0.9 },
      lawfulness:  { min: 0.6, max: 0.95 },
      anger:       { min: 0.3, max: 0.8 },
      vigilance:   { min: 0.5, max: 0.9 },   // 警觉 — 影响发现异常概率
    },
  },
}

// ── 简易确定性伪随机（基于种子字符串）────────────────────────────────────────

/** 将种子字符串转为 0~1 之间的确定性数字 */
function deterministicRandom(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  // 转为 0~1
  return (Math.abs(hash) % 10000) / 10000
}

// ── 参数生成 ─────────────────────────────────────────────────────────────────

/** 在原型参数范围内随机roll所有参数 */
export function rollNpcParams(
  archetypeId: string,
  options: NpcParamOverrides = {},
): NpcParams {
  const archetype = ARCHETYPES[archetypeId]
  if (!archetype) throw new Error(`Unknown archetype: ${archetypeId}`)

  const params: NpcParams = {}

  for (const [name, range] of Object.entries(archetype.paramRanges)) {
    if (options.overrides?.[name] !== undefined) {
      // 手工覆盖值
      params[name] = options.overrides[name]!
      continue
    }

    const seed = options.seed
      ? deterministicRandom(`${options.seed}-${name}`)
      : Math.random()

    // 在 [min, max] 范围内，保留一位小数
    const raw = range.min + seed * (range.max - range.min)
    params[name] = Math.round(raw * 10) / 10
  }

  return params
}

/** 获取原型的行为池 */
export function getBehaviorPool(archetypeId: string): string[] {
  const archetype = ARCHETYPES[archetypeId]
  return archetype?.behaviorPool ?? ['闲逛']
}

/** 获取原型的默认对话风格 */
export function getDialogueStyle(archetypeId: string): string {
  const archetype = ARCHETYPES[archetypeId]
  return archetype?.defaultDialogueStyle ?? '……'
}

// ── 约束绑定工具 ─────────────────────────────────────────────────────────────

/**
 * 基于NPC的params + rule计算此NPC是否会遵守此规则。
 * 返回 true = bound（遵守），false = unbound（不遵守）
 */
export function shouldBindRule(
  npcParams: NpcParams,
  ruleId: string,
  ruleCategory: string,
  npcTraits: string[],
  npcId: string,
): boolean {
  const lawfulness = npcParams.lawfulness ?? 0.5

  // 1. Trait 覆盖（确定性）
  if (npcTraits.includes('黑商') && ruleCategory === 'economic') return false
  if (npcTraits.includes('傲慢') && ruleCategory === 'social') return false
  if (npcTraits.includes('魔修') && ruleCategory === 'survival') return false
  // 高courage的NPC更可能违反spatial类规则（胆大妄为）
  const courage = npcParams.courage ?? 0.5
  if (courage > 0.8 && ruleCategory === 'spatial') {
    // 胆量>0.8 → 80%概率不遵守空间限制
    const seed = deterministicRandom(`${npcId}-${ruleId}-spatial`)
    if (seed < 0.8) return false
  }

  // 2. 守法度驱动的概率反叛
  const rebellionChance = 1 - lawfulness
  const seed = deterministicRandom(`${npcId}-${ruleId}`)
  if (seed < rebellionChance) return false

  // 3. 默认服从
  return true
}
