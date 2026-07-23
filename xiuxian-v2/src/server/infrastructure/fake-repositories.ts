/**
 * In-memory fake implementations of repository ports for testing.
 *
 * These fakes implement the same interfaces as the Prisma adapters,
 * using Maps for storage. They are deterministic and require no database.
 */
import type {
  PlayerRepository,
  PlayerSnapshot,
  TurnExecutionRepository,
  TurnExecutionRecord,
  OutboxRepository,
  OutboxEntry,
  ExecutionStatus,
} from './ports'

// ── Helpers ────────────────────────────────────────────────────────────

let fakeIdCounter = 0

function fakeId(): string {
  return `fake-${++fakeIdCounter}`
}

function now(): number {
  return Date.now()
}

function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

// ── Fake Player Repository ─────────────────────────────────────────────

export function createFakePlayerRepository(initialPlayers: PlayerSnapshot[] = []): PlayerRepository {
  const store = new Map<string, PlayerSnapshot>()
  for (const p of initialPlayers) {
    store.set(p.id, clone(p))
  }

  return {
    async findById(id: string): Promise<PlayerSnapshot | null> {
      const found = store.get(id)
      return found ? clone(found) : null
    },

    async save(snapshot: PlayerSnapshot, expectedVersion: number) {
      const existing = store.get(snapshot.id)
      if (!existing) {
        return { ok: false, code: 'PLAYER_NOT_FOUND' as const }
      }
      if (existing.version !== expectedVersion) {
        return { ok: false, code: 'TURN_CONFLICT' as const }
      }
      const newVersion = existing.version + 1
      store.set(snapshot.id, clone({ ...snapshot, version: newVersion, updatedAt: now() }))
      return { ok: true, newVersion }
    },
  }
}

// ── Fake Turn Execution Repository ─────────────────────────────────────

export function createFakeTurnExecutionRepository(): TurnExecutionRepository {
  const store = new Map<string, TurnExecutionRecord>()

  function makeRecord(
    playerId: string,
    idempotencyKey: string,
    requestId: string,
    status: ExecutionStatus = 'PENDING',
  ): TurnExecutionRecord {
    return {
      id: fakeId(),
      playerId,
      idempotencyKey,
      status,
      requestId,
      runId: null,
      errorCode: null,
      errorDetail: null,
      attemptCount: 1,
      candidateText: null,
      createdAt: now(),
      updatedAt: now(),
    }
  }

  function findExisting(playerId: string, idempotencyKey: string): TurnExecutionRecord | undefined {
    for (const r of store.values()) {
      if (r.playerId === playerId && r.idempotencyKey === idempotencyKey) {
        return r
      }
    }
    return undefined
  }

  return {
    async reserve(playerId, idempotencyKey, requestId) {
      const existing = findExisting(playerId, idempotencyKey)
      if (existing) {
        if (existing.status === 'COMPLETED') {
          return { ok: false, code: 'ALREADY_COMPLETED' as const, existingRecord: clone(existing) }
        }
        if (existing.status === 'PENDING' || existing.status === 'RUNNING') {
          return { ok: false, code: 'DUPLICATE_RUNNING' as const, existingRecord: clone(existing) }
        }
        // FAILED or CANCELLED → allow retry with incremented attempt
        const record = clone({ ...existing, status: 'PENDING' as const, attemptCount: existing.attemptCount + 1, updatedAt: now() })
        store.set(record.id, record)
        return { ok: true, record: clone(record) }
      }
      const record = makeRecord(playerId, idempotencyKey, requestId)
      store.set(record.id, record)
      return { ok: true, record: clone(record) }
    },

    async markRunning(id: string): Promise<void> {
      const r = store.get(id)
      if (r) {
        store.set(id, { ...r, status: 'RUNNING', updatedAt: now() })
      }
    },

    async markCompleted(id: string, candidateText: string): Promise<void> {
      const r = store.get(id)
      if (r) {
        store.set(id, { ...r, status: 'COMPLETED', candidateText, updatedAt: now() })
      }
    },

    async markFailed(id: string, errorCode: string, errorDetail: string): Promise<void> {
      const r = store.get(id)
      if (r) {
        store.set(id, { ...r, status: 'FAILED', errorCode, errorDetail, updatedAt: now() })
      }
    },

    async markCancelled(id: string, reason: string): Promise<void> {
      const r = store.get(id)
      if (r) {
        store.set(id, { ...r, status: 'CANCELLED', errorDetail: reason, updatedAt: now() })
      }
    },

    async findByIdempotencyKey(playerId: string, idempotencyKey: string): Promise<TurnExecutionRecord | null> {
      const found = findExisting(playerId, idempotencyKey)
      return found ? clone(found) : null
    },
  }
}

// ── Fake Outbox Repository ─────────────────────────────────────────────

export function createFakeOutboxRepository(): OutboxRepository {
  const store = new Map<string, OutboxEntry>()

  return {
    async enqueue(entry): Promise<OutboxEntry> {
      const record: OutboxEntry = {
        id: fakeId(),
        playerId: entry.playerId,
        eventType: entry.eventType,
        payload: clone(entry.payload),
        status: 'PENDING',
        attemptCount: 0,
        maxAttempts: entry.maxAttempts,
        lastError: null,
        nextRetryAt: null,
      }
      store.set(record.id, record)
      return clone(record)
    },

    async getPending(limit: number): Promise<OutboxEntry[]> {
      const now_ = now()
      const pending: OutboxEntry[] = []
      for (const r of store.values()) {
        if (r.status === 'PENDING' || (r.status === 'FAILED' && r.nextRetryAt !== null && r.nextRetryAt <= now_)) {
          pending.push(clone(r))
          if (pending.length >= limit) break
        }
      }
      return pending
    },

    async markCompleted(id: string): Promise<void> {
      const r = store.get(id)
      if (r) {
        store.set(id, { ...r, status: 'COMPLETED' })
      }
    },

    async markFailed(id: string, error: string, retryAfterMs?: number): Promise<void> {
      const r = store.get(id)
      if (r) {
        const newAttemptCount = r.attemptCount + 1
        const isExhausted = newAttemptCount >= r.maxAttempts
        store.set(id, {
          ...r,
          status: isExhausted ? 'FAILED' : 'FAILED',
          attemptCount: newAttemptCount,
          lastError: error,
          nextRetryAt: isExhausted ? null : (retryAfterMs ? now() + retryAfterMs : null),
        })
      }
    },
  }
}
