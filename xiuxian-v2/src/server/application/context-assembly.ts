/**
 * Context Assembly — 分层上下文组装（替代简单字符串拼接）
 *
 * 三层架构：
 *   Layer 1（静态层）：GM角色、叙事规则、工具使用规范 — 会话级别缓存
 *   Layer 2（动态层）：玩家状态、NPC在场、位置图鉴、事件、前情提要 — 每回合刷新
 *   Layer 3（临时层）：本轮工具结果、中间推理 — 回合结束丢弃
 */
import type { PlayerSnapshot } from '../infrastructure/ports'
import { formatWorldTime } from './agent-loop'

// ── Types ─────────────────────────────────────────────────────────────────

export interface DynamicSceneContext {
  npcsHere: string
  locationDesc: string
  situationsSummary: string
  narrativeSummary: string
}

export interface AssembledContext {
  systemPrompt: string
  estimatedTokens: number
}

// ── Layer 1: Static Rules ─────────────────────────────────────────────────

const GM_STATIC_RULES = `你是一个修仙世界的游戏主控AI（Game Master）。你需要根据玩家的输入推进剧情、描述场景、处理互动。

【叙事规则】
- 描述具体发现物（物品/生物/NPC/事件）前，必须先调用对应的探查工具（SearchArea / ExamineObject / LookAround）
- 描述移动过程、环境气氛、角色感受 → 不需要工具
- 工具返回什么就描述什么，不添加工具未返回的内容
- **重要**：上文提到过的NPC、地点、事件必须保持一致性。如果前情提要或在场人物中已经描述了某个人物，后续叙述必须延续这些信息，不能当作不存在
- 使用文学化的修仙风格叙述，让玩家沉浸在这个世界中`

// ── Layer 2: Dynamic State ───────────────────────────────────────────────

function buildPlayerStateBlock(player: PlayerSnapshot): string {
  const lines = [
    `角色名称: ${player.name}`,
    `性别: ${player.gender}`,
    `当前位置: ${player.currentLocation ?? '新手村'}`,
    `游戏时间: ${formatWorldTime(player.worldTime ?? Date.now())}`,
    `境界: ${player.stats.realm}`,
    `生命: ${player.stats.hp.current}/${player.stats.hp.max}`,
    `灵力: ${player.stats.mp.current}/${player.stats.mp.max}`,
    `神识: ${player.stats.spirit.value}`,
    `灵根: ${player.stats.spiritual_root}`,
    `精神状态: ${player.stats.mental_state}`,
    `运势: ${player.stats.fortune}`,
    `因果: ${player.stats.karma}`,
    `状态: ${player.status === 'DEAD' ? '已死亡' : '存活'}`,
  ]
  return lines.join('\n')
}

function buildInventoryBlock(player: PlayerSnapshot): string {
  return player.inventory.map((i) => `${i.name}×${i.count}`).join('、') || '空空如也'
}

function buildTechniqueBlock(player: PlayerSnapshot): string {
  const techs = player.stats.techniques
  if (!techs) return '无'
  return [techs.main, ...(techs.combat ?? []), techs.movement, ...(techs.support ?? [])]
    .filter(Boolean)
    .join('、')
}

function buildTraitBlock(player: PlayerSnapshot): string {
  return ((player.stats.traits as string[]) ?? []).join('、') || '无'
}

function buildSceneBlock(ctx: DynamicSceneContext): string {
  const parts: string[] = []
  if (ctx.locationDesc) {
    parts.push(`【场景描述】\n${ctx.locationDesc}`)
  }
  if (ctx.npcsHere) {
    parts.push(`【在场人物】\n${ctx.npcsHere}`)
  }
  if (ctx.situationsSummary) {
    parts.push(`【活跃事件】\n${ctx.situationsSummary}`)
  }
  if (ctx.narrativeSummary) {
    parts.push(`【前情提要】\n${ctx.narrativeSummary}`)
  }
  return parts.length > 0 ? '\n\n' + parts.join('\n\n') : ''
}

function buildPlanBlock(planContext?: {
  planSteps: string[]
  completedSteps: Array<{ stepIndex: number; summary: string }>
}): string {
  if (!planContext || planContext.planSteps.length === 0) return ''
  const planLines = planContext.planSteps
    .map((step, i) => {
      const done = planContext.completedSteps.find((cs) => cs.stepIndex === i)
      const marker = done ? '✓' : '○'
      const detail = done ? ` — ${done.summary}` : ''
      return `${marker} ${i + 1}. ${step}${detail}`
    })
    .join('\n')
  return `\n\n【当前行动计划】\n${planLines}\n\n请按计划步骤推进。每步可调用工具实现，完成后用自然语言叙述结果。`
}

// ── Main Assembly ─────────────────────────────────────────────────────────

export function assembleContext(params: {
  player: PlayerSnapshot
  ragContext: string
  iteration: number
  softLimit: number
  planContext?: {
    planSteps: string[]
    completedSteps: Array<{ stepIndex: number; summary: string }>
  }
  sceneContext?: DynamicSceneContext
}): AssembledContext {
  const { player, ragContext, iteration, softLimit, planContext, sceneContext } = params

  const stateBlock = buildPlayerStateBlock(player)
  const inventoryBlock = buildInventoryBlock(player)
  const techniqueBlock = buildTechniqueBlock(player)
  const traitBlock = buildTraitBlock(player)

  const ragBlock = ragContext ? `\n\n【相关背景知识】\n${ragContext}` : ''
  const sceneBlock = sceneContext ? buildSceneBlock(sceneContext) : ''
  const planBlock = buildPlanBlock(planContext)

  const budgetHint =
    iteration >= softLimit
      ? `\n\n[系统提示] 当前是第${iteration}轮思考。请在1-2轮内收束当前场景，给玩家一个明确的阶段性结论或选择。`
      : ''

  const systemPrompt = `${GM_STATIC_RULES}

【玩家当前状态】
${stateBlock}
技能: ${techniqueBlock}
特质: ${traitBlock}
背包: ${inventoryBlock}${ragBlock}${sceneBlock}${planBlock}${budgetHint}`

  // 简单token估算：中文≈1.5 token/字
  const estimatedTokens = Math.ceil(systemPrompt.length * 0.6)

  return { systemPrompt, estimatedTokens }
}
