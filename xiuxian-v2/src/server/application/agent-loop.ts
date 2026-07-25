/**
 * Agent Loop — pure TypeScript while-loop game Agent.
 *
 * Replaces the linear 12-step pipeline with an iterative tool-calling loop:
 *   context assembly → LLM streaming → gate check → tool execution → observe → repeat
 *
 * Key design decisions (from architecture-brainstorm-log.md Chapter 10):
 * - Implicit Done: model returns text without tool_use → turn complete
 * - Dynamic budget: heuristic complexity estimate → soft/hard iteration limits
 * - Ephemeral tool results: perception query results pruned between iterations
 * - Gate enforcement: capability.beforeExecute checks tool-catalog rules
 * - Text = game content: LLM output streams directly to player UI
 */
import type {
  LLMProvider,
  LLMProviderConfig,
  RAGProvider,
  SummaryProvider,
  Clock,
  IdGenerator,
  EventSink,
} from '../infrastructure/dependency-ports'
import type { EnvelopeEvent } from '../streaming/event-factory'
import type {
  PlayerRepository,
  PlayerSnapshot,
  TurnExecutionRepository,
  OutboxRepository,
} from '../infrastructure/ports'
import { processRuleEngine } from '../domain/rule-engine'
import type { RuleEngineDeps } from '../domain/rule-engine'
import { validateToolCalls } from '../domain/tool-schemas'
import { commitGameTurn, rollbackGameTurn } from '../infrastructure/transaction'
import {
  getToolsForCaller,
  getToolDefinition,
  toLlmToolDefinitions,
  type ToolDefinition,
} from '../contracts/tool-catalog'
import { createGameLogger } from '../observability/game-logger'
import { buildWorldOverview } from '../domain/entity-selector'
import type { GameLogger } from '../observability/game-logger'
import { compressMessages, estimateTokens } from './context-compression'
import { getRegionState } from '../domain/region-state'
import { TOOL_GATE_CHECKS } from '../domain/gate-checks'
import type { GateCheckContext } from '../domain/gate-checks'

// ── Logger ───────────────────────────────────────────────────────────────

const agentLogger: GameLogger = createGameLogger({
  service: 'game-agent',
  level: 'info',
})

// ── Model Context Limits ─────────────────────────────────────────────────

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'deepseek-chat': 65536,
}
const DEFAULT_CONTEXT_LIMIT = 65536

// ── Public Types ──────────────────────────────────────────────────────────

export interface AgentLoopDeps {
  playerRepo: PlayerRepository
  turnRepo: TurnExecutionRepository
  outboxRepo: OutboxRepository
  llmProvider: LLMProvider
  ragProvider: RAGProvider
  summaryProvider: SummaryProvider
  clock: Clock
  idGen: IdGenerator
  eventSink: EventSink
}

export interface GameTurnRequest {
  playerId: string
  playerName: string
  input: string
  mode: 'action' | 'dialogue' | 'exploration' | 'prepare'
  idempotencyKey: string
  llmConfig: LLMProviderConfig
  signal?: AbortSignal
  timeoutMs?: number
}

// ── Internal State ────────────────────────────────────────────────────────

interface AgentState {
  /** Player snapshot at turn start (immutable reference for commit) */
  player: PlayerSnapshot
  /** Accumulated LLM text across iterations */
  accumulatedText: string
  /** Tool results from current iteration (ephemeral) */
  toolResults: Array<{ toolCallId?: string; name: string; result: Record<string, unknown> }>
  /** Cumulative game state changes from rule engine */
  stats: Record<string, unknown>
  inventory: Array<Record<string, unknown>>
  codex: Array<Record<string, unknown>>
  relationships: Record<string, number>
  situations: Array<Record<string, unknown>>
  foreshadowings: Array<Record<string, unknown>>
  deltas: Record<string, unknown>
  /** World state */
  worldTime: number
  currentLocation: string
  npcs: Array<Record<string, unknown>>
  /** Plan-and-Execute */
  planSteps: string[]
  completedSteps: Array<{ stepIndex: number; toolName: string; summary: string }>
  planningPhase: boolean
  /** Iteration counter */
  iteration: number
  /** Whether the Agent has finished (LLM returned no tool_use) */
  done: boolean
  /** Whether the caller cancelled */
  cancelled: boolean
  /** Compressed narrative summary from previous turns */
  narrativeSummary: string
}

interface ComplexityBudget {
  softLimit: number
  hardLimit: number
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function formatWorldTime(ms: number): string {
  const base = new Date(2026, 0, 1).getTime() // 游戏元年
  const elapsed = ms - base
  const days = Math.floor(elapsed / 86400000)
  const hours = Math.floor((elapsed % 86400000) / 3600000)
  return `修仙历${days + 1}天 ${hours}时`
}

function parsePlanFromText(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^\d+[\.\)、]/.test(l))
    .map((l) => l.replace(/^\d+[\.\)、]\s*/, ''))
}

function isSimpleInput(input: string): boolean {
  const trimmed = input.trim()
  if (trimmed.length <= 3) return true
  // 纯问候/确认类短句
  if (/^(你好|在吗|嗯|哦|好|可以|行|继续|然后|ok|hi|hey|bye)$/i.test(trimmed)) return true
  return false
}

// ── Trope Extraction ──────────────────────────────────────────────────────

interface TropeInfo {
  genre: string
  title: string
  hint: string
}

function extractTropeInfo(input: string): TropeInfo | null {
  const genreMatch = input.match(/\[GENRE\](.+?)(?:\n|$)/)
  const titleMatch = input.match(/\[TITLE\](.+?)(?:\n|$)/)
  const hintMatch = input.match(/\[HINT\](.+?)(?:\n|$)/)
  if (!genreMatch && !titleMatch) return null
  return {
    genre: genreMatch?.[1]?.trim() ?? '未知',
    title: titleMatch?.[1]?.trim() ?? '未知',
    hint: hintMatch?.[1]?.trim() ?? '',
  }
}

function isPrepareInput(input: string): boolean {
  return input.includes('[STREAM_START]') && input.includes('[STREAM_END]')
}

// ── Planning Prompts ──────────────────────────────────────────────────────

function buildDefaultPlanningPrompt(player: PlayerSnapshot, input: string): string {
  return `你是一个修仙世界的游戏主控AI（Game Master）。

【当前状态】
- 玩家: ${player.name}，${player.stats.realm}，位于${player.currentLocation ?? '新手村'}
- 玩家输入: "${input}"

【任务】
在调用任何工具之前，先制定一个简短的行动计划。列出你需要执行的步骤（通常1-3步即可）。

【输出格式】
只输出编号列表，每行一个步骤。不要调用工具，不要写叙述文字。示例：
1. 探查当前位置的环境信息
2. 根据探查结果生成场景描述

现在请为玩家输入制定计划：`
}

function buildPreparePlanningPrompt(
  player: PlayerSnapshot,
  tropeInfo: TropeInfo | null,
): string {
  const tropeBlock = tropeInfo
    ? `\n【开局流派】\n- 流派: ${tropeInfo.title}\n- 标签: ${tropeInfo.genre}\n- 核心要素: ${tropeInfo.hint}`
    : ''

  const worldOverview = buildWorldOverview()

  return `你是一个修仙世界的游戏主控AI（Game Master）。游戏刚开始，玩家"${player.name}"（${player.stats.realm}）即将踏入修仙世界。${tropeBlock}

【已有的世界设施】
${worldOverview}

【你的任务】
作为GM，你需要为这个新游戏做好世界搭建工作。请制定一个完整的开局准备计划。

**重要：优先选择已有设施**
- 为玩家选择宗门时，从上面列出的已知宗门中选最匹配的，不要创建新的
- 描述场景时，优先使用已知地点。只有玩家流派需要特殊场景时才创建新地点
- NPC和剧情事件可以自由生成

计划步骤建议：
1. 根据流派从已知宗门中选择玩家所属宗门（如"剑修"→金剑门）
2. 确定玩家初始位置（从已知地点中选，默认"新手村"或"青云坊市"）
3. 生成2-3个与开局相关的NPC角色
4. 创建开局剧情事件
5. 用文学化的修仙风格为玩家写出开场叙事

【输出格式】
只输出编号列表，每行一个步骤。不要调用工具，不要写叙述文字。每个步骤应对应一个具体的工具调用。

现在请制定开局准备计划：`
}

// ── Complexity Estimation ─────────────────────────────────────────────────

const COMPLEXITY_PATTERNS: Array<{ regex: RegExp; soft: number; hard: number }> = [
  { regex: /打|战斗|攻击|杀|逃|防御|施法|交手|对决|搏斗/, soft: 15, hard: 25 },
  { regex: /去|探索|寻找|前往|调查|潜入|跋涉|远行|穿过/, soft: 8, hard: 16 },
]

function estimateComplexity(input: string): ComplexityBudget {
  for (const pattern of COMPLEXITY_PATTERNS) {
    if (pattern.regex.test(input)) {
      return { softLimit: pattern.soft, hardLimit: pattern.hard }
    }
  }
  return { softLimit: 3, hardLimit: 6 }
}

// ── Gate System ───────────────────────────────────────────────────────────

interface GateResult {
  allowed: boolean
  reason?: string
}

function capabilityGate(
  toolName: string,
  args: Record<string, unknown>,
  state: AgentState,
): GateResult {
  // 1. 查找工具定义
  const toolDef = getToolDefinition(toolName)
  if (!toolDef) return { allowed: true } // 未知工具放行

  const gateLevel = toolDef.gate ?? 'none'
  if (gateLevel === 'none') return { allowed: true }

  // 2. 构建检查上下文
  const regionState = getRegionState()
  const statsRecord = state.stats as Record<string, unknown>
  const npcsHere = (state.npcs as Array<Record<string, unknown>>).filter(
    (n) => n.currentLocation === state.currentLocation,
  )
  const ctx: GateCheckContext = {
    args,
    currentLocation: state.currentLocation,
    playerRealm: (statsRecord.realm as string) ?? '凡人',
    playerHp: (statsRecord.hp as { current: number; max: number }) ?? { current: 100, max: 100 },
    npcsAtLocation: npcsHere.map((n) => ({ id: n.id as string, name: n.name as string })),
    locationConstraint: regionState.getLocationConstraint(state.currentLocation),
  }

  // 3. 禁区先行拦截（适用所有工具的通用检查）
  const targetLoc = args.to as string | undefined
  if (targetLoc && regionState.isForbidden(targetLoc)) {
    return { allowed: false, reason: `"${targetLoc}" 是禁区，无法进入` }
  }

  // 4. 工具特定检查
  const checks = TOOL_GATE_CHECKS[toolName]
  if (checks) {
    for (const check of checks) {
      const result = check(ctx)
      if (!result.allowed) {
        if (gateLevel === 'enforce') return result
        // validate 模式：不拦截但 Agent 后续可能收到警告
      }
    }
  }

  return { allowed: true }
}

// ── System Prompt Builder ─────────────────────────────────────────────────

function buildSystemPrompt(
  player: PlayerSnapshot,
  ragContext: string,
  iteration: number,
  softLimit: number,
  planContext?: { planSteps: string[]; completedSteps: Array<{ stepIndex: number; summary: string }> },
  sceneContext?: { npcsHere: string; locationDesc: string; situationsSummary: string; narrativeSummary: string },
): string {
  const stateBlock = [
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
  ].join('\n')

  const inventoryNames =
    player.inventory.map((i) => `${i.name}×${i.count}`).join('、') || '空空如也'

  const techs = player.stats.techniques
  const techniqueNames = techs
    ? [techs.main, ...(techs.combat ?? []), techs.movement, ...(techs.support ?? [])]
        .filter(Boolean)
        .join('、')
    : '无'

  const traitNames = (player.stats.traits as string[])?.join('、') || '无'
  const ragBlock = ragContext ? `\n\n【相关背景知识】\n${ragContext}` : ''

  // 场景上下文：NPC在场 + 位置图鉴 + 活跃事件 + 前情提要
  let sceneBlock = ''
  if (sceneContext) {
    const parts: string[] = []
    if (sceneContext.locationDesc) {
      parts.push(`【场景描述】\n${sceneContext.locationDesc}`)
    }
    if (sceneContext.npcsHere) {
      parts.push(`【在场人物】\n${sceneContext.npcsHere}`)
    }
    if (sceneContext.situationsSummary) {
      parts.push(`【活跃事件】\n${sceneContext.situationsSummary}`)
    }
    if (sceneContext.narrativeSummary) {
      parts.push(`【前情提要】\n${sceneContext.narrativeSummary}`)
    }
    if (parts.length > 0) {
      sceneBlock = '\n\n' + parts.join('\n\n')
    }
  }

  const budgetHint =
    iteration >= softLimit
      ? `\n\n[系统提示] 当前是第${iteration}轮思考。请在1-2轮内收束当前场景，给玩家一个明确的阶段性结论或选择。`
      : ''

  let planBlock = ''
  if (planContext && planContext.planSteps.length > 0) {
    const planLines = planContext.planSteps.map((step, i) => {
      const done = planContext.completedSteps.find((cs) => cs.stepIndex === i)
      const marker = done ? '✓' : '○'
      const detail = done ? ` — ${done.summary}` : ''
      return `${marker} ${i + 1}. ${step}${detail}`
    }).join('\n')
    planBlock = `\n\n【当前行动计划】\n${planLines}\n\n请按计划步骤推进。每步可调用工具实现，完成后用自然语言叙述结果。`
  }

  return `你是一个修仙世界的游戏主控AI（Game Master）。你需要根据玩家的输入推进剧情、描述场景、处理互动。

【叙事规则】
- 描述具体发现物（物品/生物/NPC/事件）前，必须先调用对应的探查工具（SearchArea / ExamineObject / LookAround）
- 描述移动过程、环境气氛、角色感受 → 不需要工具
- 工具返回什么就描述什么，不添加工具未返回的内容
- **重要**：上文提到过的NPC、地点、事件必须保持一致性。如果前情提要或在场人物中已经描述了某个人物，后续叙述必须延续这些信息，不能当作不存在
- 使用文学化的修仙风格叙述，让玩家沉浸在这个世界中

【玩家当前状态】
${stateBlock}
技能: ${techniqueNames}
特质: ${traitNames}
背包: ${inventoryNames}${ragBlock}${sceneBlock}${planBlock}${budgetHint}`
}

// ── Tool Definition Builder ───────────────────────────────────────────────

function buildToolDefinitions(): Array<{
  name: string
  description: string
  parameters: Record<string, unknown>
}> {
  const gmTools = getToolsForCaller('game_master')
  const defs = toLlmToolDefinitions(gmTools).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  }))
  return defs
}

// ── Main Entry Point ──────────────────────────────────────────────────────

export async function agentLoop(
  deps: AgentLoopDeps,
  request: GameTurnRequest,
): Promise<void> {
  const {
    playerRepo,
    turnRepo,
    outboxRepo,
    llmProvider,
    ragProvider,
    clock,
    idGen,
    eventSink,
  } = deps

  const requestId = idGen.requestId()
  const runId = idGen.runId()
  const txDeps = { playerRepo, executionRepo: turnRepo, outboxRepo }

  let seq = 0
  function emit(type: string, payload: Record<string, unknown>): void {
    eventSink.emit({
      protocolVersion: '1.0',
      requestId,
      runId,
      sequence: seq++,
      occurredAt: clock.iso(),
      type,
      payload,
    } satisfies EnvelopeEvent)
  }

  // ── Step 1: Reserve idempotency slot ─────────────────────────────────
  const reserveResult = await turnRepo.reserve(
    request.playerId,
    request.idempotencyKey,
    requestId,
  )

  let executionId: string

  if (!reserveResult.ok) {
    if (reserveResult.code === 'DUPLICATE_RUNNING') {
      eventSink.fail({
        code: 'TURN_IN_PROGRESS',
        message: 'A turn is already in progress for this player',
        retryable: true,
      })
      return
    }
    if (reserveResult.code === 'ALREADY_COMPLETED') {
      if (reserveResult.existingRecord) {
        executionId = reserveResult.existingRecord.id
      }
      eventSink.complete()
      return
    }
    eventSink.fail({
      code: 'INTERNAL_ERROR',
      message: 'Unexpected reservation result',
      retryable: false,
    })
    return
  }

  executionId = reserveResult.record.id
  await turnRepo.markRunning(executionId)

  // ── Step 2: Load player ──────────────────────────────────────────────
  const player = await playerRepo.findById(request.playerId)
  if (!player) {
    await rollbackGameTurn(txDeps, executionId, 'PLAYER_NOT_FOUND', 'Player not found')
    eventSink.fail({
      code: 'PLAYER_NOT_FOUND',
      message: `Player ${request.playerId} not found`,
      retryable: false,
    })
    return
  }

  // ── Step 3: Emit accepted ────────────────────────────────────────────
  emit('accepted', {
    requestId,
    runId,
    playerId: request.playerId,
    mode: request.mode,
  })
  agentLogger.log({
    timestamp: clock.iso(),
    event: 'turn.accepted',
    level: 'info',
    requestId,
    runId,
    playerId: request.playerId,
  })

  // ── Step 4: RAG context (degradation-tolerant) ───────────────────────
  let ragContext = ''
  emit('step', { label: '[RAG] 检索相关知识中...' })
  try {
    const ragResult = await ragProvider.search(request.input, 5, request.signal)
    if (ragResult.ok && ragResult.results.length > 0) {
      ragContext = ragResult.results.map((r) => r.content).join('\n')
    }
    agentLogger.log({
      timestamp: clock.iso(),
      event: 'turn.rag_complete',
      level: 'info',
      requestId,
      runId,
      playerId: request.playerId,
      result_count: ragResult.ok ? ragResult.results.length : 0,
    })
    if (ragResult.ok && ragResult.results.length > 0) {
      emit('step', { label: `Executed [RAG] 检索完成 — 找到 ${ragResult.results.length} 条相关知识` })
    } else {
      emit('step', { label: 'Executed [RAG] 检索完成 — 未找到相关知识' })
    }
  } catch {
    // RAG is non-critical
    emit('step', { label: 'Executed [RAG] 检索跳过 — RAG服务不可用' })
    agentLogger.log({
      timestamp: clock.iso(),
      event: 'turn.rag_complete',
      level: 'warn',
      requestId,
      runId,
      playerId: request.playerId,
      result_count: 0,
    })
  }

  // ── Step 5: Complexity estimation ────────────────────────────────────
  const { softLimit, hardLimit } = estimateComplexity(request.input)

  // ── Step 6: Initialize Agent state ───────────────────────────────────
  const state: AgentState = {
    player,
    accumulatedText: '',
    toolResults: [],
    stats: { ...player.stats } as unknown as Record<string, unknown>,
    inventory: [...player.inventory] as unknown as Array<Record<string, unknown>>,
    codex: [...player.codex] as unknown as Array<Record<string, unknown>>,
    relationships: { ...player.relationships },
    situations: [...player.situations] as unknown as Array<Record<string, unknown>>,
    foreshadowings: [...player.foreshadowings] as unknown as Array<Record<string, unknown>>,
    worldTime: player.worldTime ?? Date.now(),
    currentLocation: player.currentLocation ?? '新手村',
    npcs: [...(player.npcs ?? [])] as unknown as Array<Record<string, unknown>>,
    deltas: {},
    iteration: 0,
    done: false,
    cancelled: false,
    planSteps: [],
    completedSteps: [],
    planningPhase: true,
    narrativeSummary: '',
  }

  // 简单输入跳过规划，直接执行
  if (isSimpleInput(request.input)) {
    state.planningPhase = false
  }

  const ruleDeps: RuleEngineDeps = {
    now: () => clock.now(),
    random: () => idGen.uuid(),
  }

  // 对话历史：每次迭代记录 assistant 的工具调用和对应的工具结果，
  // 在下一轮组装成 OpenAI/DeepSeek 兼容格式（tool_calls + tool_call_id）。
  const turnHistory: Array<{
    iteration: number
    assistantText: string | null
    toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
    toolResults: Array<{ toolCallId: string; content: string }>
  }> = []

  // ── Step 7: Main Agent Loop ──────────────────────────────────────────
  while (
    state.iteration < hardLimit &&
    !state.done &&
    !state.cancelled
  ) {
    // Check for caller abort
    if (request.signal?.aborted) {
      state.cancelled = true
      break
    }

    // ── 7a. Planning phase ─────────────────────────────────────────────
    if (state.planningPhase) {
      emit('step', { label: '[规划] AI正在制定行动计划...' })

      const isPrepare = request.mode === 'prepare' || isPrepareInput(request.input)
      const tropeInfo = isPrepare ? extractTropeInfo(request.input) : null

      const planningPrompt = isPrepare
        ? buildPreparePlanningPrompt(player, tropeInfo)
        : buildDefaultPlanningPrompt(player, request.input)

      const planningMessages = [
        { role: 'system' as const, content: planningPrompt },
        { role: 'user' as const, content: request.input },
      ]

      const planResult = await llmProvider.complete(request.llmConfig, {
        messages: planningMessages,
        tools: [], // 规划阶段不调用工具
        signal: request.signal,
        timeoutMs: 30000,
      })

      if (planResult.ok && planResult.response.content) {
        const steps = parsePlanFromText(planResult.response.content)
        if (steps.length > 0) {
          state.planSteps = steps
          emit('step', {
            label: `[规划] 计划制定完成 — ${steps.length}个步骤:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
          })
        } else {
          // 解析失败，fallback 到直接执行
          emit('step', { label: '[规划] 未能解析计划，直接执行' })
        }
      } else {
        emit('step', { label: '[规划] 规划调用失败，直接执行' })
      }

      state.planningPhase = false
      state.iteration++
      continue
    }

    // ── 7b. Assemble messages (execution phase) ─────────────────────────
    const planCtx = state.planSteps.length > 0
      ? { planSteps: state.planSteps, completedSteps: state.completedSteps }
      : undefined

    // 构建场景上下文：NPC在场 + 位置图鉴 + 活跃事件 + 前情提要
    const npcsAtLocation = (state.npcs ?? []).filter(
      (n) => n.currentLocation === state.currentLocation,
    )
    const npcsHere = npcsAtLocation.length > 0
      ? npcsAtLocation.map((n) => {
          return `- ${n.name}（${n.realm ?? '未知'}，${n.sect ?? '散修'}）：${n.description ?? ''}`
        }).join('\n')
      : ''
    const locationCodexEntry = state.codex.find(
      (e) =>
        e.name === state.currentLocation &&
        e.entry_type === 'location',
    )
    const locationDesc = locationCodexEntry
      ? (locationCodexEntry as Record<string, unknown>).description as string
      : ''
    const activeSituations = (state.situations ?? []).filter(
      (s) => s.status !== 'ended',
    )
    const situationsSummary = activeSituations.length > 0
      ? activeSituations.map((s) => {
          return `- [${s.type ?? '?'}] ${s.title}：${s.trigger ?? ''}`
        }).join('\n')
      : ''
    const narrativeSummary = state.narrativeSummary

    const systemPrompt = buildSystemPrompt(
      player,
      ragContext,
      state.iteration,
      softLimit,
      planCtx,
      (npcsHere || locationDesc || situationsSummary || narrativeSummary)
        ? { npcsHere, locationDesc, situationsSummary, narrativeSummary }
        : undefined,
    )

    let messages: Array<{
      role: string
      content: string | null
      tool_calls?: Array<{
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }>
      tool_call_id?: string
    }> = [
      { role: 'system', content: systemPrompt },
    ]

    // 始终先放用户输入
    // prepare 模式：将结构化流派数据替换为自然语言意图，避免 LLM 困惑
    const isPrepare = request.mode === 'prepare' || isPrepareInput(request.input)
    const userInput = isPrepare
      ? `开始游戏。请按照制定好的计划逐步生成世界（场景、NPC、宗门、剧情事件），最后用文学化的修仙风格为玩家写出开场叙事。`
      : request.input
    messages.push({ role: 'user', content: userInput })

    // 添加历史轮次的 assistant(tool_calls) + tool 消息对
    for (const entry of turnHistory) {
      // Assistant 消息（含 tool_calls）
      if (entry.toolCalls.length > 0) {
        messages.push({
          role: 'assistant',
          content: entry.assistantText,
          tool_calls: entry.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        })
      } else if (entry.assistantText) {
        messages.push({ role: 'assistant', content: entry.assistantText })
      }

      // Tool 结果消息（含 tool_call_id）
      for (const tr of entry.toolResults) {
        messages.push({
          role: 'tool',
          tool_call_id: tr.toolCallId,
          content: tr.content,
        })
      }
    }

    // 非首轮时追加提示
    if (state.iteration > 0) {
      messages.push({
        role: 'user',
        content: `继续。根据工具返回的结果，继续推进场景。`,
      })
    }

    // ── 7a-prime: Context compression check ────────────────────────────
    if (state.iteration > 1) {
      const contextLimit = MODEL_CONTEXT_LIMITS[request.llmConfig.modelName] ?? DEFAULT_CONTEXT_LIMIT
      const result = compressMessages({
        messages,
        systemPromptTokens: estimateTokens(systemPrompt),
        modelContextLimit: contextLimit,
      })
      if (result) {
        messages = result.compressedMessages
        state.narrativeSummary = result.narrativeSummary
      }
    }

    // ── 7b. Call LLM with streaming ────────────────────────────────────
    emit('step', {
      label: state.iteration === 0
        ? '[思考] AI正在分析你的输入...'
        : `[思考] AI正在推理... (第${state.iteration + 1}轮)`,
    })
    const llmCallStartedAt = clock.now()
    agentLogger.log({
      timestamp: clock.iso(),
      event: 'turn.llm_start',
      level: 'info',
      requestId,
      runId,
      playerId: request.playerId,
      iteration: state.iteration,
    })

    const llmResult = await llmProvider.complete(request.llmConfig, {
      messages,
      tools: buildToolDefinitions(),
      signal: request.signal,
      timeoutMs: request.timeoutMs ?? 60000,
    })

    const llmCallDurationMs = clock.now() - llmCallStartedAt

    if (!llmResult.ok) {
      const err = llmResult.error

      if (err.code === 'LLM_ABORTED') {
        state.cancelled = true
        break
      }

      // On LLM error mid-loop, fail the entire turn
      await rollbackGameTurn(txDeps, executionId, err.code, err.message)
      eventSink.fail({
        code: err.code,
        message: err.message,
        retryable: err.retryable,
      })
      return
    }

    const response = llmResult.response

    agentLogger.log({
      timestamp: clock.iso(),
      event: 'turn.llm_end',
      level: 'info',
      requestId,
      runId,
      playerId: request.playerId,
      iteration: state.iteration,
      duration_ms: llmCallDurationMs,
      tool_count: response.toolCalls.length,
      token_usage: response.usage
        ? { prompt: response.usage.promptTokens, completion: response.usage.completionTokens, total: response.usage.totalTokens }
        : undefined,
    })

    // ── 7c. Emit text delta ────────────────────────────────────────────
    if (response.content) {
      emit('text-delta', { content: response.content })
      state.accumulatedText += response.content
    }

    // ── 7d. Check for Done ──────────────────────────────────────────
    // If LLM returned text (narrative for player) AND no tool calls, done.
    // If LLM returned tools — execute them, then:
    //   - If text was also returned: done after tool execution
    //     (player already saw the narrative; tools were side-effects)
    //   - If no text (only tools): loop again for LLM to narrate results
    const hasText = response.content && response.content.length > 0
    const hasTools = response.toolCalls.length > 0

    if (!hasTools) {
      state.done = true
      break
    }

    // ── 7e. Gate check + validate + execute tools ──────────────────────
    const turnToolResults: Array<{ toolCallId: string; content: string }> = []

    const toolNames = response.toolCalls.map(tc => tc.name).join(', ')
    emit('step', { label: `Executed [工具] AI决定调用: ${toolNames}` })

    // Validate all tool calls first
    agentLogger.log({
      timestamp: clock.iso(),
      event: 'turn.tool_validation',
      level: 'info',
      requestId,
      runId,
      playerId: request.playerId,
      iteration: state.iteration,
      tool_count: response.toolCalls.length,
    })

    const validation = validateToolCalls(
      response.toolCalls.map((tc) => ({
        name: tc.name,
        args: tc.arguments,
      })),
    )

    if (!validation.valid) {
      // 找到实际失败的工具（validation.toolName 指向问题工具）
      const failedToolName = validation.toolName ?? response.toolCalls[0]?.name
      const failedCall = response.toolCalls.find((tc) => tc.name === failedToolName) ?? response.toolCalls[0]
      const argsPreview = failedCall
        ? `${failedCall.name}(${JSON.stringify(failedCall.arguments).slice(0, 500)})`
        : 'unknown'
      // 提取 Zod 校验细节
      const zodDetails = validation.details
        ? (validation.details as { issues?: Array<{ path: (string | number)[]; message: string }> })?.issues
            ?.map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ') ?? ''
        : ''
      const detailSuffix = zodDetails ? ` — 校验细节: ${zodDetails}` : ''
      emit('step', { label: `[验证] 工具调用校验失败: ${validation.message} — ${argsPreview}${detailSuffix}` })
      agentLogger.log({
        timestamp: clock.iso(),
        event: 'turn.failed',
        level: 'error',
        requestId,
        runId,
        playerId: request.playerId,
        error_code: 'TOOL_VALIDATION_ERROR',
        retryable: false,
      })
      // Fail immediately on unrecoverable validation errors.
      // Future enhancement: for MALFORMED_ARGS on known tools,
      // inject error observation and let LLM self-correct.
      await rollbackGameTurn(
        txDeps,
        executionId,
        'TOOL_VALIDATION_ERROR',
        validation.message,
      )
      eventSink.fail({
        code: 'TOOL_VALIDATION_ERROR',
        message: validation.message,
        retryable: false,
      })
      return
    }

    for (const tc of response.toolCalls) {
      // Gate check
      emit('step', { label: `[Node] ${tc.name} — 校验权限...` })
      const gateResult = capabilityGate(tc.name, tc.arguments, state)
      if (!gateResult.allowed) {
        emit('step', { label: `[Node] ${tc.name} — 被闸门拦截: ${gateResult.reason ?? '无权限'}` })
        state.toolResults.push({
          name: tc.name,
          result: { blocked: true, reason: gateResult.reason },
        })
        turnToolResults.push({
          toolCallId: tc.id,
          content: JSON.stringify({ blocked: true, reason: gateResult.reason }),
        })
        continue
      }

      // Apply tool through rule engine
      emit('step', { label: `Executed [工具] ${tc.name} — 执行中...` })
      const codexLenBefore = state.codex.length
      const toolCalls = [{ name: tc.name, args: tc.arguments }]
      const engineResult = processRuleEngine(
        toolCalls,
        state.stats as unknown as import('@/types').ICharacterStats,
        state.inventory as unknown as import('@/types').IInventoryItem[],
        state.codex as unknown as Array<{
          id: string
          name: string
          entry_type: string
          description: string
          metadata: Record<string, unknown>
          timestamp: number
        }>,
        state.relationships,
        state.situations as unknown as import('@/types').Situation[],
        state.foreshadowings as unknown as import('@/types').Foreshadowing[],
        ruleDeps,
        state.worldTime as number,
        state.currentLocation as string,
        (state.npcs ?? []) as unknown as import('@/types').T1Npc[],
      )

      // Merge rule engine results into state
      state.stats = engineResult.stats as unknown as Record<string, unknown>
      state.inventory = engineResult.inventory as unknown as Array<Record<string, unknown>>
      state.codex = engineResult.codex as unknown as Array<Record<string, unknown>>
      state.relationships = engineResult.relationships
      state.situations = engineResult.situations as unknown as Array<Record<string, unknown>>
      state.foreshadowings = engineResult.foreshadowings as unknown as Array<Record<string, unknown>>
      state.worldTime = engineResult.worldTime
      state.currentLocation = engineResult.currentLocation
      state.npcs = engineResult.npcs as unknown as Array<Record<string, unknown>>
      Object.assign(state.deltas, engineResult.deltas)

      state.toolResults.push({
        toolCallId: tc.id,
        name: tc.name,
        result: engineResult.deltas,
      })

      turnToolResults.push({
        toolCallId: tc.id,
        content: JSON.stringify(engineResult.deltas),
      })

      // Emit step with result summary
      const deltaKeys = Object.keys(engineResult.deltas)
      const deltaDesc = deltaKeys.length > 0
        ? deltaKeys.map(k => `${k}: ${JSON.stringify(engineResult.deltas[k])}`).join(', ')
        : '无变化'
      emit('step', { label: `Executed [工具] ${tc.name} — 完成 (${deltaDesc})` })

      // Emit codex events for new entries
      if (engineResult.codex && engineResult.codex.length > codexLenBefore) {
        const newEntries = engineResult.codex.slice(codexLenBefore)
        for (const entry of newEntries) {
          const e = entry as unknown as Record<string, unknown>
          emit('codex', {
            name: e.name ?? '未知',
            entry_type: e.entry_type ?? 'general',
            description: e.description ?? '',
            timestamp: clock.now(),
          })
        }
      }

      agentLogger.log({
        timestamp: clock.iso(),
        event: 'turn.tool_execute',
        level: 'info',
        requestId,
        runId,
        playerId: request.playerId,
        iteration: state.iteration,
        tool_name: tc.name,
      })

      // 追踪计划步骤完成
      if (state.planSteps.length > 0) {
        const nextPending = state.planSteps.findIndex(
          (_, i) => !state.completedSteps.find((cs) => cs.stepIndex === i),
        )
        if (nextPending >= 0) {
          state.completedSteps.push({
            stepIndex: nextPending,
            toolName: tc.name,
            summary: deltaDesc.length > 60 ? deltaDesc.slice(0, 60) + '...' : deltaDesc,
          })
        }
      }
    }

    // ── 7f. Record tool call history for next iteration ─────────────────
    // 工具执行后总是再循环一次，让 LLM 叙述工具结果。
    // 软/硬限制防止无限循环。纯文本回复（无工具）在步骤 7d 触发 done。
    turnHistory.push({
      iteration: state.iteration,
      assistantText: response.content,
      toolCalls: response.toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      })),
      toolResults: turnToolResults,
    })

    // ── 7g. Prune old history (keep only last 2 iterations) ────────────
    while (turnHistory.length > 2) {
      turnHistory.shift()
    }

    state.iteration++

    // ── 7h. Soft limit warning ─────────────────────────────────────────
    if (state.iteration >= softLimit && state.iteration < hardLimit) {
      // The budget hint in system prompt handles the warning
    }
  }

  // 构建本回合的叙事摘要（供下回合使用）
  if (state.accumulatedText) {
    const briefText = state.accumulatedText.length > 200
      ? state.accumulatedText.slice(0, 200) + '...'
      : state.accumulatedText
    const npcNames = (state.npcs ?? [])
      .slice(-5)
      .map((n) => (n as Record<string, unknown>).name)
      .join('、')
    const parts = [`玩家"${request.playerName}"在${state.currentLocation}。`]
    if (npcNames) parts.push(`在场NPC：${npcNames}。`)
    parts.push(`上轮摘要：${briefText}`)
    state.narrativeSummary = parts.join('\n')
  }

  // ── Step 8: Handle cancellation ──────────────────────────────────────
  if (state.cancelled) {
    agentLogger.log({
      timestamp: clock.iso(),
      event: 'turn.cancelled',
      level: 'warn',
      requestId,
      runId,
      playerId: request.playerId,
      iteration: state.iteration,
    })
    await turnRepo.markCancelled(executionId, 'Caller cancelled')
    eventSink.cancel('User cancelled')
    return
  }

  // ── Step 9: Hard limit reached without done → force completion ───────
  if (!state.done && state.iteration >= hardLimit) {
    // Emit whatever text we have and complete
    if (state.accumulatedText) {
      // Text already streamed; add a system note
    }
  }

  // ── Step 10: Build final player snapshot ─────────────────────────────
  const updatedPlayer: PlayerSnapshot = {
    ...player,
    stats: state.stats as unknown as PlayerSnapshot['stats'],
    inventory: state.inventory as unknown as PlayerSnapshot['inventory'],
    codex: state.codex as unknown as PlayerSnapshot['codex'],
    relationships: state.relationships,
    situations: state.situations as unknown as PlayerSnapshot['situations'],
    foreshadowings: state.foreshadowings as unknown as PlayerSnapshot['foreshadowings'],
    worldTime: state.worldTime as number,
    currentLocation: state.currentLocation as string,
    npcs: (state.npcs ?? []) as unknown as PlayerSnapshot['npcs'],
    status:
      ((state.stats as unknown as Record<string, unknown>).hp as { current: number } | undefined)
        ?.current !== undefined && ((state.stats as unknown as Record<string, unknown>).hp as { current: number }).current <= 0
        ? 'DEAD'
        : player.status,
  }

  // ── Step 11: Atomic commit ───────────────────────────────────────────
  emit('step', { label: 'Executed [保存] 提交游戏状态...' })
  agentLogger.log({
    timestamp: clock.iso(),
    event: 'turn.commit',
    level: 'info',
    requestId,
    runId,
    playerId: request.playerId,
    iteration: state.iteration,
  })

  let commitResult: Awaited<ReturnType<typeof commitGameTurn>>
  try {
    commitResult = await commitGameTurn(
      txDeps,
      executionId,
      updatedPlayer,
      player.version,
      state.accumulatedText,
      [
        {
          eventType: 'GAME_TURN_COMPLETED',
          payload: { playerId: request.playerId, runId },
        },
      ],
    )
  } catch (err) {
    agentLogger.log({
      timestamp: clock.iso(),
      event: 'turn.rollback',
      level: 'error',
      requestId,
      runId,
      playerId: request.playerId,
      error_code: 'TRANSACTION_FAILED',
      retryable: true,
    })
    await rollbackGameTurn(
      txDeps,
      executionId,
      'TRANSACTION_FAILED',
      err instanceof Error ? err.message : 'Unknown persistence error',
    )
    eventSink.fail({
      code: 'TRANSACTION_FAILED',
      message: 'Failed to persist game turn',
      retryable: true,
    })
    return
  }

  if (!commitResult.ok) {
    agentLogger.log({
      timestamp: clock.iso(),
      event: 'turn.failed',
      level: 'error',
      requestId,
      runId,
      playerId: request.playerId,
      error_code: commitResult.code,
      retryable: commitResult.code === 'TURN_CONFLICT',
    })
    emit('failed', {
      code: commitResult.code,
      detail:
        commitResult.code === 'TURN_CONFLICT'
          ? 'Player state was modified by another request'
          : 'Transaction commit failed',
      retryable: commitResult.code === 'TURN_CONFLICT',
    })
    eventSink.complete()
    return
  }

  // ── Step 12: Emit final events ───────────────────────────────────────
  emit('step', { label: 'Done 回合完成' })
  emit('state_update', {
    player: updatedPlayer,
    deltas: state.deltas,
  })

  emit('completed', {
    reply: state.accumulatedText,
  })

  agentLogger.log({
    timestamp: clock.iso(),
    event: 'turn.complete',
    level: 'info',
    requestId,
    runId,
    playerId: request.playerId,
    iteration: state.iteration,
  })

  eventSink.complete()
}
