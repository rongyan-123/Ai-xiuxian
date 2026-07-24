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
  toLlmToolDefinitions,
  type ToolDefinition,
} from '../contracts/tool-catalog'
import { createGameLogger } from '../observability/game-logger'
import type { GameLogger } from '../observability/game-logger'

// ── Logger ───────────────────────────────────────────────────────────────

const agentLogger: GameLogger = createGameLogger({
  service: 'game-agent',
  level: 'info',
})

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
  mode: 'action' | 'dialogue' | 'exploration'
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
  toolResults: Array<{ name: string; result: Record<string, unknown> }>
  /** Cumulative game state changes from rule engine */
  stats: Record<string, unknown>
  inventory: Array<Record<string, unknown>>
  codex: Array<Record<string, unknown>>
  relationships: Record<string, number>
  situations: Array<Record<string, unknown>>
  foreshadowings: Array<Record<string, unknown>>
  deltas: Record<string, unknown>
  /** Iteration counter */
  iteration: number
  /** Whether the Agent has finished (LLM returned no tool_use) */
  done: boolean
  /** Whether the caller cancelled */
  cancelled: boolean
}

interface ComplexityBudget {
  softLimit: number
  hardLimit: number
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

// HACK: 闸门系统当前为stub，所有工具无条件放行。Phase 2需接入world state单例后实现gateRules检查。2026-07-24
function capabilityGate(toolName: string, _args: Record<string, unknown>): GateResult {
  void _args
  void toolName
  return { allowed: true }
}

// ── System Prompt Builder ─────────────────────────────────────────────────

function buildSystemPrompt(
  player: PlayerSnapshot,
  ragContext: string,
  iteration: number,
  softLimit: number,
): string {
  const stateBlock = [
    `角色名称: ${player.name}`,
    `性别: ${player.gender}`,
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

  const budgetHint =
    iteration >= softLimit
      ? `\n\n[系统提示] 当前是第${iteration}轮思考。请在1-2轮内收束当前场景，给玩家一个明确的阶段性结论或选择。`
      : ''

  return `你是一个修仙世界的游戏主控AI（Game Master）。你需要根据玩家的输入推进剧情、描述场景、处理互动。

【叙事规则】
- 描述具体发现物（物品/生物/NPC/事件）前，必须先调用对应的探查工具（SearchArea / ExamineObject / LookAround）
- 描述移动过程、环境气氛、角色感受 → 不需要工具
- 工具返回什么就描述什么，不添加工具未返回的内容
- 使用文学化的修仙风格叙述，让玩家沉浸在这个世界中

【玩家当前状态】
${stateBlock}
技能: ${techniqueNames}
特质: ${traitNames}
背包: ${inventoryNames}${ragBlock}${budgetHint}`
}

// ── Tool Definition Builder ───────────────────────────────────────────────

function buildToolDefinitions(): Array<{
  name: string
  description: string
  parameters: Record<string, unknown>
}> {
  const gmTools = getToolsForCaller('game_master')
  return toLlmToolDefinitions(gmTools).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  }))
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
    deltas: {},
    iteration: 0,
    done: false,
    cancelled: false,
  }

  const ruleDeps: RuleEngineDeps = {
    now: () => clock.now(),
    random: () => idGen.uuid(),
  }

  // Ephemeral message pruning: remove old tool results, keep last N
  const toolResultHistory: Array<{
    iteration: number
    results: Array<{ name: string; result: Record<string, unknown> }>
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

    // ── 7a. Assemble messages ──────────────────────────────────────────
    const systemPrompt = buildSystemPrompt(
      player,
      ragContext,
      state.iteration,
      softLimit,
    )

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
    ]

    // Add ephemeral tool results from previous iterations
    for (const entry of toolResultHistory) {
      for (const tr of entry.results) {
        messages.push({
          role: 'tool',
          content: `[${tr.name} 结果]\n${JSON.stringify(tr.result)}`,
        })
      }
    }

    // Add conversation history placeholder (accumulated text from prior iterations)
    if (state.accumulatedText && state.iteration > 0) {
      messages.push({
        role: 'assistant',
        content: state.accumulatedText,
      })
    }

    // Add user input
    messages.push({
      role: 'user',
      content:
        state.iteration === 0
          ? request.input
          : `继续。根据工具返回的结果，继续推进场景。`,
    })

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
    state.toolResults = []

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
      emit('step', { label: `[验证] 工具调用校验失败: ${validation.message}` })
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
      const gateResult = capabilityGate(tc.name, tc.arguments)
      if (!gateResult.allowed) {
        emit('step', { label: `[Node] ${tc.name} — 被闸门拦截: ${gateResult.reason ?? '无权限'}` })
        state.toolResults.push({
          name: tc.name,
          result: { blocked: true, reason: gateResult.reason },
        })
        continue
      }

      // Apply tool through rule engine
      emit('step', { label: `Executed [工具] ${tc.name} — 执行中...` })
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
      )

      // Merge rule engine results into state
      state.stats = engineResult.stats as unknown as Record<string, unknown>
      state.inventory = engineResult.inventory as unknown as Array<Record<string, unknown>>
      state.codex = engineResult.codex as unknown as Array<Record<string, unknown>>
      state.relationships = engineResult.relationships
      state.situations = engineResult.situations as unknown as Array<Record<string, unknown>>
      state.foreshadowings = engineResult.foreshadowings as unknown as Array<Record<string, unknown>>
      Object.assign(state.deltas, engineResult.deltas)

      state.toolResults.push({
        name: tc.name,
        result: engineResult.deltas,
      })

      // Emit step with result summary
      const deltaKeys = Object.keys(engineResult.deltas)
      const deltaDesc = deltaKeys.length > 0
        ? deltaKeys.map(k => `${k}: ${JSON.stringify(engineResult.deltas[k])}`).join(', ')
        : '无变化'
      emit('step', { label: `Executed [工具] ${tc.name} — 完成 (${deltaDesc})` })

      // Emit codex events for new entries
      if (engineResult.codex && engineResult.codex.length > player.codex.length) {
        const newEntries = engineResult.codex.slice(player.codex.length)
        for (const entry of newEntries) {
          emit('codex', {
            name: (entry as Record<string, unknown>).name ?? '未知',
            entry_type: (entry as Record<string, unknown>).entry_type ?? 'general',
            description: (entry as Record<string, unknown>).description ?? '',
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
    }

    // ── 7f. Record tool results for next iteration ─────────────────────
    toolResultHistory.push({
      iteration: state.iteration,
      results: [...state.toolResults],
    })

    // If the LLM returned text alongside tools, the narrative has been
    // streamed to the player. Mark done so we don't loop unnecessarily.
    // Pure-tool responses (no text) will loop for narration.
    if (hasText) {
      state.done = true
      break
    }

    // ── 7g. Prune ephemeral results (keep only last 2 iterations) ──────
    while (toolResultHistory.length > 2) {
      toolResultHistory.shift()
    }

    state.iteration++

    // ── 7h. Soft limit warning ─────────────────────────────────────────
    if (state.iteration >= softLimit && state.iteration < hardLimit) {
      // The budget hint in system prompt handles the warning
    }
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
