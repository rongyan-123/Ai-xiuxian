/**
 * ExecuteGameTurn — canonical game-turn application service.
 *
 * Thin facade over the Agent Loop engine. Delegates all orchestration to
 * agentLoop() while preserving the original public interface so route.ts
 * requires no changes.
 *
 * The Agent Loop replaces the previous linear 12-step pipeline with an
 * iterative while-loop: context → LLM → tool calls → gate → execute → repeat.
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
import type {
  PlayerRepository,
  TurnExecutionRepository,
  OutboxRepository,
} from '../infrastructure/ports'
import { agentLoop } from './agent-loop'
import type { AgentLoopDeps, GameTurnRequest as AgentGameTurnRequest } from './agent-loop'

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

// ── Main Entry Point ──────────────────────────────────────────────────────

export async function executeGameTurn(
  deps: ExecuteGameTurnDeps,
  request: GameTurnRequest,
): Promise<void> {
  // Convert to Agent Loop types (structurally identical — just forward)
  const loopDeps: AgentLoopDeps = deps
  const loopRequest: AgentGameTurnRequest = request
  return agentLoop(loopDeps, loopRequest)
}
