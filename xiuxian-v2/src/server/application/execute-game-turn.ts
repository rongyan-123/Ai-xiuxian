/**
 * ExecuteGameTurn — canonical game-turn application service.
 *
 * This is the SINGLE entry point for all game-turn execution. It coordinates:
 * 1. Idempotency reservation
 * 2. Player snapshot loading
 * 3. RAG context retrieval (degradation-tolerant)
 * 4. LLM invocation with tool calling
 * 5. Tool call validation via Zod schemas
 * 6. Pure rule engine evaluation
 * 7. Atomic persistence with optimistic concurrency
 * 8. SSE event emission
 * 9. Post-commit outbox enqueue
 *
 * All dependencies are injected — zero module-level mutable state.
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
import { validateToolCalls, TOOL_SCHEMAS } from '../domain/tool-schemas'
import { commitGameTurn, rollbackGameTurn } from '../infrastructure/transaction'

// ── Public Types ──────────────────────────────────────────────────────────

export interface ExecuteGameTurnDeps {
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

// ── Tool Definitions ──────────────────────────────────────────────────────

function buildToolDefinitions(): Array<{
  name: string
  description: string
  parameters: Record<string, unknown>
}> {
  // Convert Zod schemas to JSON Schema for LLM tool calling.
  // Each tool gets a minimal description; the Zod schema provides the parameters shape.
  const descriptions: Record<string, string> = {
    Backpack_additems: 'Add items to player inventory',
    Backpack_reduceitems: 'Reduce or remove items from inventory',
    Consume_Item: 'Use/consume an item (e.g., pill, elixir)',
    Modify_Stats: 'Modify character stats (HP, MP, spirit, etc.)',
    Modify_Techniques: 'Add, upgrade, or remove techniques',
    Modify_Traits: 'Add or remove character traits',
    Modify_Mental: 'Change mental/emotional state',
    Update_Relationship: 'Modify NPC relationship values',
    Change_Location: 'Move player to a new location',
    Check_Breakthrough: 'Attempt realm breakthrough',
    Generate_NPC: 'Generate a new NPC',
    Generate_Location: 'Generate a new location',
    Generate_Sect: 'Generate a new sect/clan',
    Generate_Item: 'Generate a new item',
    Write_Codex: 'Create a codex entry',
    Write_Journal: 'Create a journal entry',
    Update_Situation: 'Update or create a situation',
    Create_Foreshadowing: 'Create or resolve a foreshadowing',
    Search_History: 'Search conversation history',
    Skip: 'Skip with a reason (no-op turn)',
  }

  return Object.entries(TOOL_SCHEMAS).map(([name, schema]) => ({
    name,
    description: descriptions[name] ?? name,
    parameters: zodToJsonSchema(schema),
  }))
}

function zodToJsonSchema(schema: unknown): Record<string, unknown> {
  // Minimal Zod → JSON Schema conversion sufficient for LLM tool definitions.
  // A full implementation would use zod-to-json-schema; this handles the common case.
  try {
    const def = (schema as { _def?: { typeName?: string; shape?: unknown; values?: unknown } })._def
    if (!def) return { type: 'object', properties: {} }

    const typeName = def.typeName
    switch (typeName) {
      case 'ZodObject':
        return zodObjectToJsonSchema(schema as { shape: Record<string, unknown> })
      case 'ZodEnum':
        return { type: 'string', enum: Object.keys((def.values as Record<string, unknown>) ?? {}) }
      case 'ZodString':
        return { type: 'string' }
      case 'ZodNumber':
        return { type: 'number' }
      case 'ZodBoolean':
        return { type: 'boolean' }
      case 'ZodArray':
        return { type: 'array' }
      case 'ZodOptional':
      case 'ZodDefault': {
        const inner = (schema as { _def: { innerType: unknown } })._def?.innerType
        return inner ? zodToJsonSchema(inner) : { type: 'string' }
      }
      default:
        return { type: 'object', properties: {} }
    }
  } catch {
    return { type: 'object', properties: {} }
  }
}

function zodObjectToJsonSchema(schema: { shape: Record<string, unknown> }): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [key, fieldSchema] of Object.entries(schema.shape)) {
    const fieldDef = (fieldSchema as { _def?: { typeName?: string } })._def
    const isOptional = fieldDef?.typeName === 'ZodOptional' || fieldDef?.typeName === 'ZodDefault'
    if (!isOptional) {
      required.push(key)
    }
    properties[key] = zodToJsonSchema(fieldSchema)
  }

  return { type: 'object', properties, required: required.length > 0 ? required : undefined }
}

// ── Prompt Builder ────────────────────────────────────────────────────────

function buildSystemPrompt(player: PlayerSnapshot, ragContext: string): string {
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

  const inventoryNames = player.inventory.map(i => `${i.name}×${i.count}`).join('、') || '空空如也'

  const techs = player.stats.techniques
  const techniqueNames = techs
    ? [techs.main, ...(techs.combat ?? []), techs.movement, ...(techs.support ?? [])].filter(Boolean).join('、')
    : '无'

  const traitNames = (player.stats.traits as string[])?.join('、') || '无'

  const ragBlock = ragContext ? `\n\n【相关背景知识】\n${ragContext}` : ''

  return `你是一个修仙世界的游戏主控AI。你需要根据玩家的输入，推进剧情、描述场景、处理战斗和互动。

【玩家当前状态】
${stateBlock}
技能: ${techniqueNames}
特质: ${traitNames}
背包: ${inventoryNames}${ragBlock}

你可以通过调用工具来修改游戏状态。请使用文学化的修仙风格叙述，让玩家沉浸在这个世界中。`
}

// ── Main Entry Point ──────────────────────────────────────────────────────

export async function executeGameTurn(
  deps: ExecuteGameTurnDeps,
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

  // ── Step 1: Reserve idempotency slot ───────────────────────────────
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
      // Replay completed result — no side effects
      if (reserveResult.existingRecord) {
        executionId = reserveResult.existingRecord.id
      }
      eventSink.complete()
      return
    }
    // Should not reach here
    eventSink.fail({
      code: 'INTERNAL_ERROR',
      message: 'Unexpected reservation result',
      retryable: false,
    })
    return
  }

  executionId = reserveResult.record.id
  await turnRepo.markRunning(executionId)

  // ── Step 2: Load player ────────────────────────────────────────────
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

  // ── Step 3: Emit accepted ──────────────────────────────────────────
  emit('accepted', {
    requestId,
    runId,
    playerId: request.playerId,
    mode: request.mode,
  })

  // ── Step 4: RAG context (degradation-tolerant) ─────────────────────
  let ragContext = ''
  try {
    const ragResult = await ragProvider.search(request.input, 5, request.signal)
    if (ragResult.ok && ragResult.results.length > 0) {
      ragContext = ragResult.results.map(r => r.content).join('\n')
    }
  } catch {
    // RAG is non-critical — continue without context
  }

  // ── Step 5: Build LLM request ──────────────────────────────────────
  const systemPrompt = buildSystemPrompt(player, ragContext)
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: request.input },
  ]

  // ── Step 6: Call LLM ───────────────────────────────────────────────
  const llmResult = await llmProvider.complete(request.llmConfig, {
    messages,
    tools: buildToolDefinitions(),
    signal: request.signal,
    timeoutMs: request.timeoutMs ?? 60000,
  })

  if (!llmResult.ok) {
    const err = llmResult.error

    if (err.code === 'LLM_ABORTED') {
      await turnRepo.markCancelled(executionId, 'Caller cancelled')
      eventSink.cancel('User cancelled')
      return
    }

    await rollbackGameTurn(txDeps, executionId, err.code, err.message)
    eventSink.fail({
      code: err.code,
      message: err.message,
      retryable: err.retryable,
    })
    return
  }

  const response = llmResult.response

  // ── Step 7: Validate tool calls ────────────────────────────────────
  if (response.toolCalls.length > 0) {
    const validation = validateToolCalls(
      response.toolCalls.map(tc => ({
        name: tc.name,
        args: tc.arguments,
      })),
    )

    if (!validation.valid) {
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
  }

  // ── Step 8: Run rule engine ────────────────────────────────────────
  const ruleDeps: RuleEngineDeps = {
    now: () => clock.now(),
    random: () => idGen.uuid(),
  }

  const validatedCalls = response.toolCalls.map(tc => ({
    name: tc.name,
    args: tc.arguments,
  }))

  const ruleResult = processRuleEngine(
    validatedCalls,
    player.stats,
    [...player.inventory],
    [...player.codex],
    { ...player.relationships },
    [...player.situations],
    [...player.foreshadowings],
    ruleDeps,
  )

  // ── Step 9: Emit text delta ────────────────────────────────────────
  if (response.content) {
    emit('text-delta', { content: response.content })
  }

  // ── Step 10: Build updated player snapshot ─────────────────────────
  const updatedPlayer: PlayerSnapshot = {
    ...player,
    stats: ruleResult.stats,
    inventory: ruleResult.inventory,
    codex: ruleResult.codex as PlayerSnapshot['codex'],
    relationships: ruleResult.relationships,
    situations: ruleResult.situations,
    foreshadowings: ruleResult.foreshadowings,
    status: ruleResult.stats.hp.current <= 0 ? 'DEAD' : player.status,
  }

  // ── Step 11: Atomic commit ─────────────────────────────────────────
  let commitResult: Awaited<ReturnType<typeof commitGameTurn>>
  try {
    commitResult = await commitGameTurn(
      txDeps,
      executionId,
      updatedPlayer,
      player.version,
      response.content ?? '',
      [
        {
          eventType: 'GAME_TURN_COMPLETED',
          payload: { playerId: request.playerId, runId },
        },
      ],
    )
  } catch (err) {
    // Unexpected persistence failure (e.g., DB connection lost)
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
    emit('failed', {
      code: commitResult.code,
      message: commitResult.code === 'TURN_CONFLICT'
        ? 'Player state was modified by another request'
        : 'Transaction commit failed',
    })
    eventSink.fail({
      code: commitResult.code,
      message: 'Failed to persist game turn',
      retryable: commitResult.code === 'TURN_CONFLICT',
    })
    return
  }

  // ── Step 12: Emit state update and completed ───────────────────────
  emit('state_update', {
    player: updatedPlayer,
    deltas: ruleResult.deltas,
  })

  emit('completed', {
    reply: response.content ?? '',
  })

  eventSink.complete()
}
