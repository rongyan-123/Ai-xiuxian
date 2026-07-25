/**
 * Prisma adapter implementations of repository ports.
 *
 * These adapters implement the port interfaces from ports.ts using
 * Prisma ORM and PostgreSQL. They are the production implementations
 * injected into the application service.
 */
import type { PrismaClient } from '@prisma/client'
import type {
  PlayerRepository,
  PlayerSnapshot,
  CodexEntry,
  TurnExecutionRepository,
  TurnExecutionRecord,
  ExecutionStatus,
  OutboxRepository,
  OutboxEntry,
} from './ports'
import type { ICharacterStats, IInventoryItem, Situation, Foreshadowing, T1Npc } from '@/types'

// ── Helpers ────────────────────────────────────────────────────────────

function toPlayerSnapshot(row: {
  id: string
  status: string
  name: string
  gender: string
  version: number
  stats: unknown
  inventory: unknown
  codex: unknown
  relationships: unknown
  situations: unknown
  foreshadowings: unknown
  worldTime?: bigint | null
  currentLocation?: string | null
  npcs?: unknown
  createdAt: Date
  updatedAt: Date
}): PlayerSnapshot {
  return {
    id: row.id,
    status: row.status as 'ALIVE' | 'DEAD',
    name: row.name,
    gender: row.gender,
    version: row.version,
    stats: row.stats as ICharacterStats,
    inventory: (row.inventory as IInventoryItem[]) || [],
    codex: (row.codex as CodexEntry[]) || [],
    relationships: (row.relationships as Record<string, number>) || {},
    situations: (row.situations as Situation[]) || [],
    foreshadowings: (row.foreshadowings as Foreshadowing[]) || [],
    worldTime: row.worldTime != null ? Number(row.worldTime) : Date.now(),
    currentLocation: row.currentLocation ?? '新手村',
    npcs: (row.npcs as T1Npc[]) || [],
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

function toExecutionRecord(row: {
  id: string
  playerId: string
  idempotencyKey: string
  status: string
  requestId: string
  runId: string | null
  errorCode: string | null
  errorDetail: string | null
  attemptCount: number
  candidateText: string | null
  createdAt: Date
  updatedAt: Date
}): TurnExecutionRecord {
  return {
    id: row.id,
    playerId: row.playerId,
    idempotencyKey: row.idempotencyKey,
    status: row.status as ExecutionStatus,
    requestId: row.requestId,
    runId: row.runId,
    errorCode: row.errorCode,
    errorDetail: row.errorDetail,
    attemptCount: row.attemptCount,
    candidateText: row.candidateText,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

// ── Player Repository ─────────────────────────────────────────────────

export function createPrismaPlayerRepository(prisma: PrismaClient): PlayerRepository {
  return {
    async findById(id: string): Promise<PlayerSnapshot | null> {
      const row = await prisma.player.findUnique({ where: { id } })
      if (!row) return null
      return toPlayerSnapshot(row)
    },

    async save(snapshot: PlayerSnapshot, expectedVersion: number) {
      try {
        const result = await prisma.player.updateMany({
          where: {
            id: snapshot.id,
            version: expectedVersion,
          },
          data: {
            status: snapshot.status,
            name: snapshot.name,
            gender: snapshot.gender,
            version: expectedVersion + 1,
            stats: snapshot.stats as any,
            inventory: snapshot.inventory as any,
            codex: snapshot.codex as any,
            relationships: snapshot.relationships as any,
            situations: snapshot.situations as any,
            foreshadowings: snapshot.foreshadowings as any,
            worldTime: BigInt(snapshot.worldTime),
            currentLocation: snapshot.currentLocation,
            npcs: snapshot.npcs as any,
          },
        })

        if (result.count === 0) {
          // Check if player exists at all
          const exists = await prisma.player.findUnique({ where: { id: snapshot.id }, select: { id: true } })
          if (!exists) {
            return { ok: false as const, code: 'PLAYER_NOT_FOUND' as const }
          }
          return { ok: false as const, code: 'TURN_CONFLICT' as const }
        }

        return { ok: true as const, newVersion: expectedVersion + 1 }
      } catch {
        return { ok: false as const, code: 'TURN_CONFLICT' as const }
      }
    },
  }
}

// ── Turn Execution Repository ─────────────────────────────────────────

export function createPrismaTurnExecutionRepository(prisma: PrismaClient): TurnExecutionRepository {
  return {
    async reserve(playerId, idempotencyKey, requestId) {
      const existing = await prisma.gameTurnExecution.findUnique({
        where: {
          playerId_idempotencyKey: { playerId, idempotencyKey },
        },
      })

      if (existing) {
        if (existing.status === 'COMPLETED') {
          return {
            ok: false as const,
            code: 'ALREADY_COMPLETED' as const,
            existingRecord: toExecutionRecord(existing),
          }
        }
        if (existing.status === 'PENDING' || existing.status === 'RUNNING') {
          return {
            ok: false as const,
            code: 'DUPLICATE_RUNNING' as const,
            existingRecord: toExecutionRecord(existing),
          }
        }
        // FAILED or CANCELLED → allow retry
        const updated = await prisma.gameTurnExecution.update({
          where: { id: existing.id },
          data: {
            status: 'PENDING',
            requestId,
            attemptCount: existing.attemptCount + 1,
            errorCode: null,
            errorDetail: null,
          },
        })
        return { ok: true as const, record: toExecutionRecord(updated) }
      }

      const created = await prisma.gameTurnExecution.create({
        data: {
          playerId,
          idempotencyKey,
          requestId,
          status: 'PENDING',
          attemptCount: 1,
        },
      })
      return { ok: true as const, record: toExecutionRecord(created) }
    },

    async markRunning(id: string): Promise<void> {
      await prisma.gameTurnExecution.update({
        where: { id },
        data: { status: 'RUNNING' },
      })
    },

    async markCompleted(id: string, candidateText: string): Promise<void> {
      await prisma.gameTurnExecution.update({
        where: { id },
        data: { status: 'COMPLETED', candidateText },
      })
    },

    async markFailed(id: string, errorCode: string, errorDetail: string): Promise<void> {
      await prisma.gameTurnExecution.update({
        where: { id },
        data: { status: 'FAILED', errorCode, errorDetail },
      })
    },

    async markCancelled(id: string, reason: string): Promise<void> {
      await prisma.gameTurnExecution.update({
        where: { id },
        data: { status: 'CANCELLED', errorDetail: reason },
      })
    },

    async findByIdempotencyKey(playerId: string, idempotencyKey: string): Promise<TurnExecutionRecord | null> {
      const row = await prisma.gameTurnExecution.findUnique({
        where: { playerId_idempotencyKey: { playerId, idempotencyKey } },
      })
      if (!row) return null
      return toExecutionRecord(row)
    },
  }
}

// ── Outbox Repository ─────────────────────────────────────────────────

export function createPrismaOutboxRepository(prisma: PrismaClient): OutboxRepository {
  return {
    async enqueue(entry): Promise<OutboxEntry> {
      const created = await prisma.outboxRecord.create({
        data: {
          playerId: entry.playerId,
          eventType: entry.eventType,
          payload: entry.payload as any,
          maxAttempts: entry.maxAttempts,
          status: 'PENDING',
          attemptCount: 0,
        },
      })
      return {
        id: created.id,
        playerId: created.playerId,
        eventType: created.eventType,
        payload: created.payload as Record<string, unknown>,
        status: created.status as OutboxEntry['status'],
        attemptCount: created.attemptCount,
        maxAttempts: created.maxAttempts,
        lastError: created.lastError,
        nextRetryAt: created.nextRetryAt?.getTime() ?? null,
      }
    },

    async getPending(limit: number): Promise<OutboxEntry[]> {
      const now = new Date()
      const rows = await prisma.outboxRecord.findMany({
        where: {
          status: 'PENDING',
          OR: [
            { nextRetryAt: null },
            { nextRetryAt: { lte: now } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
      })

      // Also get retryable FAILED entries
      const retryableRows = await prisma.outboxRecord.findMany({
        where: {
          status: 'FAILED',
          attemptCount: { lt: prisma.outboxRecord.fields.maxAttempts },
          nextRetryAt: { lte: now },
        },
        orderBy: { nextRetryAt: 'asc' },
        take: limit - rows.length,
      })

      return [...rows, ...retryableRows].slice(0, limit).map((r) => ({
        id: r.id,
        playerId: r.playerId,
        eventType: r.eventType,
        payload: r.payload as Record<string, unknown>,
        status: r.status as OutboxEntry['status'],
        attemptCount: r.attemptCount,
        maxAttempts: r.maxAttempts,
        lastError: r.lastError,
        nextRetryAt: r.nextRetryAt?.getTime() ?? null,
      }))
    },

    async markCompleted(id: string): Promise<void> {
      await prisma.outboxRecord.update({
        where: { id },
        data: { status: 'COMPLETED' },
      })
    },

    async markFailed(id: string, error: string, retryAfterMs?: number): Promise<void> {
      const existing = await prisma.outboxRecord.findUnique({ where: { id } })
      if (!existing) return

      const newAttemptCount = existing.attemptCount + 1
      const isExhausted = newAttemptCount >= existing.maxAttempts

      await prisma.outboxRecord.update({
        where: { id },
        data: {
          status: 'FAILED',
          attemptCount: newAttemptCount,
          lastError: error,
          nextRetryAt: isExhausted || !retryAfterMs
            ? null
            : new Date(Date.now() + retryAfterMs),
        },
      })
    },
  }
}
