/**
 * Repository port interfaces for persistence.
 *
 * These ports define WHAT the application needs from storage, without
 * coupling to Prisma, PostgreSQL, or any specific ORM/database.
 *
 * Application code depends on these interfaces; infrastructure adapters
 * implement them.
 */
import type { ICharacterStats, IInventoryItem, Situation, Foreshadowing, T1Npc } from '@/types'

// ── Player snapshot (immutable view of persisted player state) ──────────

export interface PlayerSnapshot {
  id: string
  status: 'ALIVE' | 'DEAD'
  name: string
  gender: string
  version: number
  stats: ICharacterStats
  inventory: IInventoryItem[]
  codex: CodexEntry[]
  relationships: Record<string, number>
  situations: Situation[]
  foreshadowings: Foreshadowing[]
  worldTime: number
  currentLocation: string
  npcs: T1Npc[]
  createdAt: number
  updatedAt: number
}

export interface CodexEntry {
  id: string
  name: string
  entry_type: string
  description: string
  metadata: Record<string, unknown>
  timestamp: number
}

// ── Turn execution status ──────────────────────────────────────────────

export type ExecutionStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

export interface TurnExecutionRecord {
  id: string
  playerId: string
  idempotencyKey: string
  status: ExecutionStatus
  requestId: string
  runId: string | null
  errorCode: string | null
  errorDetail: string | null
  attemptCount: number
  candidateText: string | null
  createdAt: number
  updatedAt: number
}

// ── Outbox record ──────────────────────────────────────────────────────

export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'

export interface OutboxEntry {
  id: string
  playerId: string
  eventType: string
  payload: Record<string, unknown>
  status: OutboxStatus
  attemptCount: number
  maxAttempts: number
  lastError: string | null
  nextRetryAt: number | null
}

// ── Player repository port ─────────────────────────────────────────────

export interface PlayerRepository {
  /** Load a player by ID. Returns null if not found. */
  findById(id: string): Promise<PlayerSnapshot | null>

  /**
   * Save player state with optimistic version check.
   *
   * The expectedVersion must match the current persisted version.
   * If it doesn't match, the save is rejected with a TURN_CONFLICT error.
   * On success, the player version is incremented.
   */
  save(
    snapshot: PlayerSnapshot,
    expectedVersion: number,
  ): Promise<{ ok: true; newVersion: number } | { ok: false; code: 'TURN_CONFLICT' | 'PLAYER_NOT_FOUND' }>
}

// ── Turn execution repository port ─────────────────────────────────────

export interface TurnExecutionRepository {
  /**
   * Reserve an idempotency slot for a new turn.
   *
   * If a record with the same (playerId, idempotencyKey) already exists:
   * - COMPLETED → return the existing record (replay without side effects)
   * - FAILED/CANCELLED → allow retry (return null to indicate new attempt)
   * - PENDING/RUNNING → return conflict to prevent concurrent execution
   */
  reserve(
    playerId: string,
    idempotencyKey: string,
    requestId: string,
  ): Promise<
    | { ok: true; record: TurnExecutionRecord }
    | { ok: false; code: 'DUPLICATE_RUNNING' | 'ALREADY_COMPLETED'; existingRecord?: TurnExecutionRecord }
  >

  /** Mark an execution as RUNNING (increment attempt count). */
  markRunning(id: string): Promise<void>

  /** Mark an execution as COMPLETED with final text. */
  markCompleted(id: string, candidateText: string): Promise<void>

  /** Mark an execution as FAILED with error info. */
  markFailed(id: string, errorCode: string, errorDetail: string): Promise<void>

  /** Mark an execution as CANCELLED. */
  markCancelled(id: string, reason: string): Promise<void>

  /** Find execution by player + idempotency key. */
  findByIdempotencyKey(playerId: string, idempotencyKey: string): Promise<TurnExecutionRecord | null>
}

// ── Outbox repository port ─────────────────────────────────────────────

export interface OutboxRepository {
  /** Enqueue a post-commit job. */
  enqueue(entry: Omit<OutboxEntry, 'id' | 'status' | 'attemptCount' | 'lastError' | 'nextRetryAt'>): Promise<OutboxEntry>

  /** Get pending outbox entries that are ready for processing. */
  getPending(limit: number): Promise<OutboxEntry[]>

  /** Mark an outbox entry as COMPLETED. */
  markCompleted(id: string): Promise<void>

  /** Mark an outbox entry as FAILED, optionally scheduling a retry. */
  markFailed(id: string, error: string, retryAfterMs?: number): Promise<void>
}
