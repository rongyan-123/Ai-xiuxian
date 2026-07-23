/**
 * Refactored LangGraph workflow using dependency ports and pure rule engine.
 *
 * This factory creates a game-turn graph where every node receives its
 * dependencies through the graph state or closure — zero module-level
 * mutable state. All persistence goes through the transaction coordinator;
 * all tool execution goes through the pure rule engine.
 *
 * The graph has 4 nodes:
 *   rag_retriever → plot_director → rule_engine → db_persist
 *
 * Each node is a thin wrapper that delegates to injected ports.
 */
import { StateGraph, Annotation, START, END } from '@langchain/langgraph'
import type { BaseMessage } from '@langchain/core/messages'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import type {
  LLMProvider,
  RAGProvider,
  SummaryProvider,
  Clock,
  IdGenerator,
} from '../infrastructure/dependency-ports'
import type {
  PlayerRepository,
  PlayerSnapshot,
  TurnExecutionRepository,
  OutboxRepository,
} from '../infrastructure/ports'
import type { ICharacterStats, IInventoryItem, Situation, Foreshadowing } from '@/types'
import { processRuleEngine } from '../domain/rule-engine'
import { validateToolCalls } from '../domain/tool-schemas'
import { commitGameTurn } from '../infrastructure/transaction'

// ── Graph State ──────────────────────────────────────────────────────────

export interface GameGraphState {
  messages: BaseMessage[]
  playerId: string
  playerName: string
  player: PlayerSnapshot | null
  stats: ICharacterStats
  inventory: IInventoryItem[]
  codex: Array<{ id: string; name: string; entry_type: string; description: string; metadata: Record<string, unknown>; timestamp: number }>
  relationships: Record<string, number>
  situations: Situation[]
  foreshadowings: Foreshadowing[]
  ragContext: string
  finalReply: string
  deltas: Record<string, unknown>
  stepLogs: string[]
  executionId: string
  executionError: string | null
}

const GameStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    default: () => [],
    reducer: (prev, next) => [...prev, ...next],
  }),
  playerId: Annotation<string>(),
  playerName: Annotation<string>(),
  player: Annotation<PlayerSnapshot | null>(),
  stats: Annotation<ICharacterStats>(),
  inventory: Annotation<IInventoryItem[]>(),
  codex: Annotation<Array<{ id: string; name: string; entry_type: string; description: string; metadata: Record<string, unknown>; timestamp: number }>>(),
  relationships: Annotation<Record<string, number>>(),
  situations: Annotation<Situation[]>(),
  foreshadowings: Annotation<Foreshadowing[]>(),
  ragContext: Annotation<string>(),
  finalReply: Annotation<string>(),
  deltas: Annotation<Record<string, unknown>>(),
  stepLogs: Annotation<string[]>({
    default: () => [],
    reducer: (prev, next) => [...prev, ...next],
  }),
  executionId: Annotation<string>(),
  executionError: Annotation<string | null>(),
})

// ── Graph Dependencies ───────────────────────────────────────────────────

export interface GameGraphDeps {
  llmProvider: LLMProvider
  ragProvider: RAGProvider
  summaryProvider: SummaryProvider
  playerRepo: PlayerRepository
  turnRepo: TurnExecutionRepository
  outboxRepo: OutboxRepository
  clock: Clock
  idGen: IdGenerator
  llmConfig: {
    apiKey: string
    baseUrl: string
    modelName: string
    temperature?: number
  }
  /** Tool definitions for LLM tool calling */
  tools: Array<{
    name: string
    description: string
    parameters: Record<string, unknown>
  }>
}

// ── Node Implementations ─────────────────────────────────────────────────

function createRagRetrieverNode(deps: GameGraphDeps) {
  return async (state: GameGraphState): Promise<Partial<GameGraphState>> => {
    const lastMsg = state.messages.at(-1)
    const query = typeof lastMsg?.content === 'string' ? lastMsg.content : ''

    const result = await deps.ragProvider.search(query, 5)
    const ragContext = result.ok
      ? result.results.map(r => r.content).join('\n')
      : ''

    return {
      ragContext,
      stepLogs: [`RAG: ${result.ok ? `${result.results.length} results` : 'unavailable'}`],
    }
  }
}

function createPlotDirectorNode(deps: GameGraphDeps) {
  return async (state: GameGraphState): Promise<Partial<GameGraphState>> => {
    const player = state.player!
    const stateBlock = [
      `境界: ${player.stats.realm}`,
      `生命: ${player.stats.hp.current}/${player.stats.hp.max}`,
      `灵力: ${player.stats.mp.current}/${player.stats.mp.max}`,
      `神识: ${player.stats.spirit.value}`,
      `状态: ${player.status}`,
    ].join(', ')

    const ragBlock = state.ragContext ? `\n【背景】${state.ragContext}` : ''

    const messages = [
      { role: 'system' as const, content: `你是修仙世界的主控AI。玩家状态: ${stateBlock}${ragBlock}` },
      ...state.messages.map(m => ({
        role: m.getType() === 'human' ? 'user' as const : 'assistant' as const,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
    ]

    const llmResult = await deps.llmProvider.complete(deps.llmConfig, {
      messages,
      tools: deps.tools,
    })

    if (!llmResult.ok) {
      return {
        executionError: `LLM: ${llmResult.error.code} - ${llmResult.error.message}`,
        stepLogs: [`LLM failed: ${llmResult.error.code}`],
      }
    }

    const response = llmResult.response
    const aiMsg = new AIMessage({
      content: response.content ?? '',
      tool_calls: response.toolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        args: tc.arguments,
        type: 'tool_call' as const,
      })),
    })

    return {
      messages: [aiMsg],
      finalReply: response.content ?? '',
      stepLogs: [`LLM: ${response.toolCalls.length > 0 ? `${response.toolCalls.length} tool calls` : 'narrative only'}`],
    }
  }
}

function createRuleEngineNode(_deps: GameGraphDeps) {
  return async (state: GameGraphState): Promise<Partial<GameGraphState>> => {
    // Extract tool calls from the last AI message
    const lastAi = state.messages.filter(m => m.getType() === 'ai').at(-1)
    if (!lastAi) {
      return { stepLogs: ['Rule engine: no AI message to process'] }
    }

    const toolCalls: Array<{ name: string; args?: Record<string, unknown> }> = []
    const tc = (lastAi as unknown as { tool_calls?: Array<{ name: string; args: Record<string, unknown> }> }).tool_calls
    if (tc) {
      for (const t of tc) {
        toolCalls.push({ name: t.name, args: t.args })
      }
    }

    if (toolCalls.length === 0) {
      return { stepLogs: ['Rule engine: no tool calls'] }
    }

    // Validate tool calls
    const validation = validateToolCalls(toolCalls)
    if (!validation.valid) {
      return {
        executionError: `TOOL_VALIDATION_ERROR: ${validation.message}`,
        stepLogs: [`Rule engine: validation failed - ${validation.message}`],
      }
    }

    // Run rule engine
    const ruleDeps = { now: () => Date.now(), random: () => Math.random().toString(36).substr(2, 5) }
    const result = processRuleEngine(
      toolCalls,
      state.stats,
      state.inventory,
      state.codex,
      state.relationships,
      state.situations,
      state.foreshadowings,
      ruleDeps,
    )

    return {
      stats: result.stats,
      inventory: result.inventory,
      codex: result.codex,
      relationships: result.relationships,
      situations: result.situations,
      foreshadowings: result.foreshadowings,
      deltas: result.deltas,
      stepLogs: [`Rule engine: applied ${toolCalls.length} tool(s)`],
    }
  }
}

function createDbPersistNode(deps: GameGraphDeps) {
  return async (state: GameGraphState): Promise<Partial<GameGraphState>> => {
    if (state.executionError) {
      await deps.turnRepo.markFailed(state.executionId, state.executionError, state.executionError)
      return {}
    }

    const player = state.player!
    const updatedPlayer: PlayerSnapshot = {
      ...player,
      stats: state.stats,
      inventory: state.inventory,
      codex: state.codex as PlayerSnapshot['codex'],
      relationships: state.relationships,
      situations: state.situations,
      foreshadowings: state.foreshadowings,
      status: state.stats.hp.current <= 0 ? 'DEAD' : player.status,
    }

    const commitResult = await commitGameTurn(
      { playerRepo: deps.playerRepo, executionRepo: deps.turnRepo, outboxRepo: deps.outboxRepo },
      state.executionId,
      updatedPlayer,
      player.version,
      state.finalReply,
      [{ eventType: 'GAME_TURN_COMPLETED', payload: { playerId: player.id } }],
    )

    if (!commitResult.ok) {
      return {
        executionError: `COMMIT: ${commitResult.code}`,
        stepLogs: [`DB persist: failed - ${commitResult.code}`],
      }
    }

    return {
      stepLogs: ['DB persist: committed'],
    }
  }
}

// ── Graph Factory ────────────────────────────────────────────────────────

export interface CreateGraphParams {
  deps: GameGraphDeps
  initialState: {
    playerId: string
    playerName: string
    player: PlayerSnapshot
    messages: BaseMessage[]
    executionId: string
  }
}

/**
 * Create a request-scoped LangGraph workflow.
 *
 * Every node receives dependencies through closure — no module-level
 * mutable state, no direct Prisma/LLM/vector-store imports in nodes.
 */
export function createGameGraph(params: CreateGraphParams) {
  const { deps, initialState } = params
  const { player } = initialState

  const graph = new StateGraph(GameStateAnnotation)
    .addNode('rag_retriever', createRagRetrieverNode(deps))
    .addNode('plot_director', createPlotDirectorNode(deps))
    .addNode('rule_engine', createRuleEngineNode(deps))
    .addNode('db_persist', createDbPersistNode(deps))
    .addEdge(START, 'rag_retriever')
    .addEdge('rag_retriever', 'plot_director')
    .addEdge('plot_director', 'rule_engine')
    .addEdge('rule_engine', 'db_persist')
    .addEdge('db_persist', END)

  const app = graph.compile()

  return {
    graph: app,
    async invoke(userMessage: string): Promise<GameGraphState> {
      const initial: Partial<GameGraphState> = {
        playerId: initialState.playerId,
        playerName: initialState.playerName,
        player,
        stats: { ...player.stats },
        inventory: [...player.inventory],
        codex: [...player.codex],
        relationships: { ...player.relationships },
        situations: [...player.situations],
        foreshadowings: [...player.foreshadowings],
        ragContext: '',
        finalReply: '',
        deltas: {},
        stepLogs: [],
        executionId: initialState.executionId,
        executionError: null,
        messages: [...initialState.messages, new HumanMessage({ content: userMessage })],
      }

      const result = await app.invoke(initial)
      return result as GameGraphState
    },
  }
}
