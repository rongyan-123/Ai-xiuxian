/**
 * Region DM — 区域规则管理 + 约束绑定引擎
 *
 * 职责（本次实现）：
 * 1. 存储每个区域的约束规则（现阶段手写，后续LLM生成）
 * 2. 约束绑定引擎：对每个NPC × 每条规则，决定是否遵守
 * 3. 格式化约束文本，供NPC上下文注入
 *
 * 不做的：LLM事件编排、完整优先级裁决、记忆流追踪
 */
import type { T1Npc } from '@/types'
import { shouldBindRule, type NpcParams } from './npc-archetype'

// ── 约束规则类型 ─────────────────────────────────────────────────────────────

export type RuleCategory = 'social' | 'economic' | 'spatial' | 'survival'

export interface ConstraintRule {
  id: string
  category: RuleCategory
  text: string
  /** 默认是否遵守（大多数NPC会遵守） */
  defaultBound: boolean
}

export interface ConstraintBinding {
  ruleId: string
  bound: boolean
}

// ── 青云坊市约束规则（手写，后续LLM生成）──────────────────────────────────────

export const QINGYUN_MARKET_RULES: ConstraintRule[] = [
  {
    id: 'social_hierarchy',
    category: 'social',
    text: '金丹以上修士需跪拜行礼，筑基修士需恭敬对待',
    defaultBound: true,
  },
  {
    id: 'economic_fair_price',
    category: 'economic',
    text: '坊市交易价格浮动不超过30%，禁止欺诈',
    defaultBound: true,
  },
  {
    id: 'spatial_no_trespass',
    category: 'spatial',
    text: '未经许可不得进入宗门内门区域',
    defaultBound: true,
  },
  {
    id: 'survival_demon_flee',
    category: 'survival',
    text: '遇到魔教弟子应立即逃跑，不得对抗',
    defaultBound: true,
  },
  {
    id: 'economic_no_steal',
    category: 'economic',
    text: '禁止偷窃、抢劫坊市店铺',
    defaultBound: true,
  },
  {
    id: 'social_no_fight',
    category: 'social',
    text: '坊市内禁止私斗，违者将被守卫驱逐',
    defaultBound: true,
  },
  {
    id: 'spatial_night_curfew',
    category: 'spatial',
    text: '子时（23:00）后坊市主要街道实行宵禁，闲人不得游荡',
    defaultBound: true,
  },
]

// ── 区域规则注册表（后续可扩展更多区域）─────────────────────────────────────────

const REGION_RULES: Record<string, ConstraintRule[]> = {
  '青云坊市': QINGYUN_MARKET_RULES,
  // 后续添加更多区域
}

/** 获取区域的约束规则 */
export function getRegionRules(locationName: string): ConstraintRule[] {
  // 精确匹配优先
  if (REGION_RULES[locationName]) return REGION_RULES[locationName]
  // 前缀匹配
  for (const [name, rules] of Object.entries(REGION_RULES)) {
    if (locationName.startsWith(name) || name.startsWith(locationName)) {
      return rules
    }
  }
  return []
}

// ── 约束绑定引擎 ─────────────────────────────────────────────────────────────

/**
 * 为单个NPC生成所有区域规则的约束绑定。
 *
 * 绑定逻辑：
 * 1. Trait覆盖（确定性）："黑商" → 经济规则=false
 * 2. 守法度驱动概率反叛：rebellionChance = 1 - lawfulness
 *    用确定性种子（npcId + ruleId），同NPC同规则结果永远一致
 * 3. 默认服从
 */
export function generateConstraintBindings(
  npc: T1Npc,
  regionRules: ConstraintRule[],
): ConstraintBinding[] {
  const npcParams = (npc.traits ?? {}) as unknown as NpcParams
  // 从 personality 推导字符串trait标签（用于shouldBindRule的确定性覆盖）
  const traitList: string[] = []
  if (npc.personality === '贪婪') traitList.push('黑商')
  if (npc.personality === '高傲') traitList.push('傲慢')

  return regionRules.map((rule) => {
    const bound = shouldBindRule(
      npcParams,
      rule.id,
      rule.category,
      traitList,
      npc.id,
    )
    return { ruleId: rule.id, bound }
  })
}

/** 获取NPC应遵守的规则子集（bound=true的） */
export function getBoundRules(
  npc: T1Npc,
  regionRules: ConstraintRule[],
): ConstraintRule[] {
  const bindings = generateConstraintBindings(npc, regionRules)
  const boundIds = new Set(
    bindings.filter((b) => b.bound).map((b) => b.ruleId),
  )
  return regionRules.filter((r) => boundIds.has(r.id))
}

/** 获取NPC不遵守的规则列表 */
export function getUnboundRules(
  npc: T1Npc,
  regionRules: ConstraintRule[],
): ConstraintRule[] {
  const bindings = generateConstraintBindings(npc, regionRules)
  const unboundIds = new Set(
    bindings.filter((b) => !b.bound).map((b) => b.ruleId),
  )
  return regionRules.filter((r) => unboundIds.has(r.id))
}

/**
 * 格式化为NPC上下文注入文本。
 * 只包含bound=true的规则——NPC"看不到"他不遵守的规则。
 */
export function formatConstraintContext(
  npc: T1Npc,
  regionRules: ConstraintRule[],
): string {
  const bound = getBoundRules(npc, regionRules)
  if (bound.length === 0) {
    return '本区域无特定约束。'
  }
  const lines = bound.map((r) => `  - ${r.text}`)
  return `\n【区域规则 — ${npc.currentLocation}】\n${lines.join('\n')}`
}

/**
 * 调试用：获取NPC对所有规则的绑定摘要
 */
export function getBindingSummary(
  npc: T1Npc,
  regionRules: ConstraintRule[],
): string {
  const bindings = generateConstraintBindings(npc, regionRules)
  return bindings
    .map((b) => {
      const rule = regionRules.find((r) => r.id === b.ruleId)
      const status = b.bound ? '✓ 遵守' : '✗ 违反'
      return `${status} — ${rule?.text ?? b.ruleId}`
    })
    .join('\n')
}

// ── 全区域规则查询（供 Agent 使用）────────────────────────────────────────────

/** 获取玩家当前所在区域的约束规则（适用于GM agent上下文） */
export function getRegionRulesForLocation(locationName: string): ConstraintRule[] {
  return getRegionRules(locationName)
}

/** 获取区域规则覆盖的NPC列表摘要 */
export function getNpcComplianceSummary(
  npcs: T1Npc[],
  locationName: string,
): string {
  const rules = getRegionRules(locationName)
  if (rules.length === 0) return '该区域无约束规则。'

  return npcs
    .map((npc) => {
      const unbound = getUnboundRules(npc, rules)
      if (unbound.length === 0) return `${npc.name}：遵守所有规则`
      const violated = unbound.map((r) => r.id.replace(/^(social|economic|spatial|survival)_/, '')).join('、')
      return `${npc.name}：不遵守 ${violated}`
    })
    .join('\n')
}
