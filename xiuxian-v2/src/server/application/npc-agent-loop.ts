// NPC Agent Turn — 角色身份驱动的LLM交互
// NPC以"我就是这个角色"的身份调用LLM，用感知+行为工具感知世界、做出反应。
// 与GM Agent Loop完全独立：最多2轮LLM调用，不走规则引擎，不管理世界状态。

import type { T1Npc } from '@/types'
import type { ConstraintRule } from '../domain/region-dm'
import type { NpcActionType } from '../domain/npc-decision'
import type {
  LLMProvider,
  LLMProviderConfig,
  LLMRequest,
  LLMResult,
  Clock,
  IdGenerator,
  EventSink,
} from '../infrastructure/dependency-ports'
import { getToolsForCaller, toLlmToolDefinitions } from '../contracts/tool-catalog'
import { getBoundRules, formatConstraintContext } from '../domain/region-dm'
import { getBehaviorPool, getDialogueStyle } from '../domain/npc-archetype'

// ── 类型定义 ────────────────────────────────────────────────────────────────

export type NpcTurnTrigger =
  | { type: 'player_nearby'; description: string }
  | { type: 'player_dialogue'; dialogueInput: string }
  | { type: 'event_witness'; description: string }
  | { type: 'threat_detected'; description: string; threatLevel: number }
  | { type: 'scheduled_action'; description: string; actionType?: string }

export interface NpcTurnRequest {
  npc: T1Npc
  trigger: NpcTurnTrigger
  regionRules: ConstraintRule[]
  allNpcs: T1Npc[]
  gameTimeMs: number
  llmConfig: LLMProviderConfig
  signal?: AbortSignal
}

export interface NpcTurnResult {
  npc: T1Npc
  actionType: NpcActionType
  dialogue?: string
  actionNarrative?: string
  memoriesFormed: Array<{ content: string; importance: number }>
  reaction?: string
}

export interface NpcTurnDeps {
  llmProvider: LLMProvider
  clock: Clock
  idGen: IdGenerator
  eventSink?: EventSink
}

// ── 内部：上下文结构 ────────────────────────────────────────────────────────

interface NpcContext {
  identityBlock: string
  traitsBlock: string
  locationBlock: string
  npcsHere: string
  constraintBlock: string
  knowledgeBlock: string
  behaviorBlock: string
  triggerBlock: string
}

// ── 上下文组装 ──────────────────────────────────────────────────────────────

function assembleNpcContext(
  npc: T1Npc,
  trigger: NpcTurnTrigger,
  regionRules: ConstraintRule[],
  allNpcs: T1Npc[],
  gameTimeMs: number,
): NpcContext {
  const archetypeId = npc.archetype ?? 'wanderer'

  const identityBlock = [
    `姓名：${npc.name}${npc.title ? `（${npc.title}）` : ''}`,
    `境界：${npc.realm}`,
    `性格：${npc.personality}`,
    `阵营：${npc.alignment}`,
    `宗门：${npc.sect}`,
    `简介：${npc.description}`,
  ].join('\n')

  const traits = npc.traits ?? {}
  const traitLabels: Record<string, string> = {
    greed: '贪婪', friendliness: '友善', courage: '胆量', cunning: '狡诈',
    lawfulness: '守法度', anger: '愤怒', vigilance: '警觉', gossip: '八卦',
    craftsmanship: '工艺',
  }
  const traitsBlock = Object.entries(traits)
    .map(([k, v]) => `  ${traitLabels[k] ?? k}：${(v * 100).toFixed(0)}%`)
    .join('\n')

  const otherNpcs = allNpcs.filter((n) =>
    n.id !== npc.id && n.currentLocation === npc.currentLocation,
  )
  const npcsHere = otherNpcs.length > 0
    ? otherNpcs.map((n) => `  ${n.name}${n.title ? `（${n.title}）` : ''} — ${n.personality}，${n.realm}`).join('\n')
    : '  无其他人在场'

  const boundRules = getBoundRules(npc, regionRules)
  const constraintBlock = formatConstraintContext(npc, regionRules)

  const knowledge = npc.knowledge ?? []
  const knowledgeBlock = knowledge.length > 0
    ? knowledge.slice(-5).map((k) => `  - ${k.description}`).join('\n')
    : '  暂无'

  const behaviorPool = getBehaviorPool(archetypeId).join('、')
  const dialogueStyle = getDialogueStyle(archetypeId)

  const behaviorBlock = [
    `可选行为：${behaviorPool}`,
    `说话风格：${dialogueStyle}`,
  ].join('\n')

  const triggerBlock = buildTriggerMessage(trigger)

  const d = new Date(gameTimeMs)
  const locationBlock = `${npc.currentLocation} · ${d.getHours()}时`

  return {
    identityBlock, traitsBlock, locationBlock, npcsHere,
    constraintBlock, knowledgeBlock, behaviorBlock, triggerBlock,
  }
}

// ── 触发器 → 文本 ──────────────────────────────────────────────────────────

function buildTriggerMessage(trigger: NpcTurnTrigger): string {
  switch (trigger.type) {
    case 'player_nearby':
      return `${trigger.description}。`
    case 'player_dialogue':
      return `一位修士对你说："${trigger.dialogueInput}"`
    case 'event_witness':
      return `你注意到：${trigger.description}`
    case 'threat_detected':
      return `⚠ 危险感知：${trigger.description}（威胁等级：${(trigger.threatLevel * 100).toFixed(0)}%）`
    case 'scheduled_action':
      return trigger.actionType
        ? `按照你的日程，你正在${trigger.actionType}。${trigger.description}`
        : trigger.description
  }
}

// ── NPC系统提示 ─────────────────────────────────────────────────────────────

function buildNpcSystemPrompt(npc: T1Npc, ctx: NpcContext): string {
  return `你是${npc.name}${npc.title ? `，${npc.title}` : ''}。${npc.realm}修士，${npc.sect}弟子。

【你的身份】
${ctx.identityBlock}

【你的性格参数】（0~100%，数值越高则越偏向该特质）
${ctx.traitsBlock}

【你的行事风格】
${ctx.behaviorBlock}

【当前时间与位置】
${ctx.locationBlock}

【在场其他人物】
${ctx.npcsHere}

【你必须遵守的区域规则】
${ctx.constraintBlock}

【你知道的事】
${ctx.knowledgeBlock}

【现在发生的事】
${ctx.triggerBlock}

【行为指南】
- 你就是这个角色，不是系统或管理者。以第一人称或角色口吻行动。
- 先感知再反应：可以用LookAround观察环境，用SenseDanger评估威胁，再决定如何行动。
- 你只知道当前位置发生的事，不知道远处的信息。
- 说话时使用符合你性格和说话风格的语言。语气、用词都要符合角色。
- 遇到重要事件时用FormMemory记录下来。
- 严格遵守你必须遵守的区域规则。
- 如果需要生成对话，调用GenerateDialogue工具。
- 如果需要决定对某事的反应，调用DecideReaction工具。`
}

// ── NPC工具定义 ─────────────────────────────────────────────────────────────

function buildNpcToolDefinitions(): Array<{
  name: string
  description: string
  parameters: Record<string, unknown>
}> {
  const npcTools = getToolsForCaller('llm_npc')
  return toLlmToolDefinitions(npcTools).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  }))
}

// ── NPC工具执行 ─────────────────────────────────────────────────────────────

function executeNpcTool(
  toolName: string,
  args: Record<string, unknown>,
  npc: T1Npc,
  allNpcs: T1Npc[],
  gameTimeMs: number,
): Record<string, unknown> {
  switch (toolName) {
    case 'LookAround': {
      const otherNpcs = allNpcs.filter((n) =>
        n.id !== npc.id && n.currentLocation === npc.currentLocation,
      )
      const d = new Date(gameTimeMs)
      return {
        location: npc.currentLocation,
        timeOfDay: d.getHours(),
        visibleNpcs: otherNpcs.map((n) => ({
          name: n.name,
          title: n.title ?? '',
          realm: n.realm,
          activity: n.schedule?.[0]?.activity ?? '未知',
        })),
        description: `你在${npc.currentLocation}，周围有${otherNpcs.length}人。`,
      }
    }
    case 'SearchArea': {
      const otherNpcs = allNpcs.filter((n) =>
        n.id !== npc.id && n.currentLocation === npc.currentLocation,
      )
      return {
        location: npc.currentLocation,
        npcCount: otherNpcs.length,
        npcs: otherNpcs.map((n) => ({ name: n.name, realm: n.realm })),
        notableFeatures: ['坊市街道', '店铺林立', '修士往来'],
      }
    }
    case 'ExamineObject':
      return {
        description: `你仔细观察了${args.target ?? '周围'}，没有发现特别之处。`,
      }
    case 'SenseDanger':
      return {
        threatLevel: 0,
        threats: [],
        advice: '当前未感知到明显危险。',
      }
    case 'CheckNpcState': {
      const target = allNpcs.find((n) =>
        n.name === args.name || n.id === args.npcId,
      )
      if (!target) return { found: false, reason: '未找到该人物' }
      return {
        found: true,
        name: target.name,
        realm: target.realm,
        currentActivity: target.schedule?.[0]?.activity ?? '未知',
        personality: target.personality,
        description: target.description,
      }
    }
    case 'RecallMemory': {
      const knowledge = npc.knowledge ?? []
      const keyword = (args.query as string) ?? ''
      const matches = keyword
        ? knowledge.filter((k) => k.description.includes(keyword))
        : knowledge.slice(-5)
      return {
        matches: matches.map((k) => ({
          description: k.description,
          timestamp: k.timestamp,
          location: k.location,
        })),
        totalMemories: knowledge.length,
      }
    }
    case 'FormMemory': {
      const content = (args.content as string) ?? ''
      const importance = (args.importance as number) ?? 0.5
      if (!npc.knowledge) npc.knowledge = []
      npc.knowledge.push({
        eventType: 'npc_action',
        description: content,
        location: npc.currentLocation,
        timestamp: Date.now(),
        witnesses: [npc.id],
        publicKnowledge: false,
      })
      return { memoryId: `mem-${npc.knowledge.length}`, content, importance }
    }
    case 'DecideReaction':
    case 'GenerateDialogue':
    case 'GenerateDailyPlan':
    case 'SelfReflection':
      // LLM决定型工具：返回空结果，实际内容在LLM文本中
      return { acknowledged: true, tool: toolName }
    default:
      return { error: `未知工具: ${toolName}` }
  }
}

// ── 结果萃取 ────────────────────────────────────────────────────────────────

function extractTurnResult(
  npc: T1Npc,
  content: string | null,
  toolResults: Array<{
    toolCallId: string
    name: string
    result: Record<string, unknown>
  }>,
  trigger: NpcTurnTrigger,
): NpcTurnResult {
  const dialogueTool = toolResults.find((t) => t.name === 'GenerateDialogue')
  const hasDialogueTool = dialogueTool !== undefined
  const hasAnyTools = toolResults.length > 0

  // 无工具调用 → LLM直接回应
  // trigger类型决定默认文本去向：对话类trigger→dialogue，事件/威胁类→actionNarrative
  const dialogueTriggers: NpcTurnTrigger['type'][] = ['player_dialogue', 'player_nearby']
  const isDialogueTrigger = dialogueTriggers.includes(trigger.type)

  const dialogue = hasDialogueTool
    ? ((dialogueTool?.result?.dialogue as string) ?? (dialogueTool?.result?.text as string))
    : (!hasAnyTools && content && content.length > 0 && isDialogueTrigger ? content : undefined)

  const narrativeFromContent = (hasAnyTools && !hasDialogueTool && content && content.length > 0)
    ? content
    : (!hasAnyTools && content && content.length > 0 && !isDialogueTrigger ? content : undefined)

  const reactionTool = toolResults.find((t) => t.name === 'DecideReaction')
  const reaction = reactionTool?.result?.reaction as string | undefined

  const memoryResults = toolResults.filter((t) => t.name === 'FormMemory')
  const memoriesFormed = memoryResults.map((t) => ({
    content: (t.result?.content as string) ?? '',
    importance: (t.result?.importance as number) ?? 0.5,
  }))

  // 从触发器和反应推断actionType
  let actionType: NpcActionType = 'dialogue'
  if (reaction === 'hostile' || reaction === 'fight') actionType = 'fight'
  else if (reaction === 'flee') actionType = 'flee'
  else if (dialogue) actionType = 'dialogue'
  else if (narrativeFromContent) actionType = 'wander'
  else actionType = 'wander'

  return {
    npc,
    actionType,
    dialogue,
    actionNarrative: narrativeFromContent,
    memoriesFormed,
    reaction,
  }
}

// ── 主入口 ──────────────────────────────────────────────────────────────────

export async function runNpcTurn(
  deps: NpcTurnDeps,
  request: NpcTurnRequest,
): Promise<NpcTurnResult> {
  const { npc, trigger, regionRules, allNpcs, gameTimeMs, llmConfig, signal } = request

  // 1. 组装NPC上下文
  const ctx = assembleNpcContext(npc, trigger, regionRules, allNpcs, gameTimeMs)

  // 2. 构建消息
  const systemPrompt = buildNpcSystemPrompt(npc, ctx)
  const userMessage = buildTriggerMessage(trigger)
  const tools = buildNpcToolDefinitions()

  // 3. 第一轮LLM调用
  const messages1: LLMRequest['messages'] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ]

  const result1 = await deps.llmProvider.complete(llmConfig, {
    messages: messages1,
    tools,
  })

  if (!result1.ok) {
    throw new Error(`NPC Agent LLM error: ${result1.error.code} - ${result1.error.message}`)
  }

  // 4. 如果没有工具调用，直接萃取结果
  if (result1.response.toolCalls.length === 0) {
    return extractTurnResult(npc, result1.response.content, [], trigger)
  }

  // 5. 执行工具调用
  const toolResults: Array<{
    toolCallId: string
    name: string
    result: Record<string, unknown>
  }> = []

  for (const tc of result1.response.toolCalls) {
    if (signal?.aborted) throw new Error('NPC turn aborted')
    const result = executeNpcTool(tc.name, tc.arguments, npc, allNpcs, gameTimeMs)
    toolResults.push({ toolCallId: tc.id, name: tc.name, result })
  }

  // 6. 第二轮LLM调用（带工具结果）
  const messages2: LLMRequest['messages'] = [
    ...messages1,
    {
      role: 'assistant',
      content: result1.response.content,
      tool_calls: result1.response.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    },
    ...toolResults.map((tr) => ({
      role: 'tool' as const,
      tool_call_id: tr.toolCallId,
      content: JSON.stringify(tr.result),
    })),
  ]

  const result2 = await deps.llmProvider.complete(llmConfig, {
    messages: messages2,
    tools,
  })

  if (!result2.ok) {
    // 即使第二轮失败，也返回第一轮的工具结果
    return extractTurnResult(npc, result1.response.content, toolResults, trigger)
  }

  return extractTurnResult(npc, result2.response.content, toolResults, trigger)
}
