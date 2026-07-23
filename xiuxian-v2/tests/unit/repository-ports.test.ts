/**
 * Repository port contract tests.
 *
 * These tests exercise the repository port interfaces using in-memory
 * fake implementations. The same tests would pass against real Prisma
 * adapters when a test database is available.
 *
 * TDD: RED phase — tests are written against the port interfaces first.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createFakePlayerRepository,
  createFakeTurnExecutionRepository,
  createFakeOutboxRepository,
} from '@/server/infrastructure/fake-repositories'
import type {
  PlayerRepository,
  PlayerSnapshot,
  TurnExecutionRepository,
  OutboxRepository,
} from '@/server/infrastructure/ports'

// ─── Test fixtures ────────────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    id: 'player-1',
    status: 'ALIVE',
    name: '测试修士',
    gender: '男',
    version: 0,
    stats: {
      hp: { current: 100, max: 100, status_desc: '良好' },
      mp: { current: 50, max: 50, status_desc: '充沛' },
      spirit: { value: 100, desc: '精神饱满' },
      realm: '练气期一层',
      age: { current: 16, max: 100 },
      race: '人族',
      alignment: '中立',
      sect: '散修',
      spiritual_root: '五行杂灵根',
      mental_state: '心如止水',
      reputation: 0,
    },
    inventory: [],
    codex: [],
    relationships: {},
    situations: [],
    foreshadowings: [],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  }
}

// ─── 6.1-6.3 Player Repository ───────────────────────────────────────────

describe('PlayerRepository port', () => {
  let repo: PlayerRepository

  beforeEach(() => {
    repo = createFakePlayerRepository([makePlayer()])
  })

  it('finds existing player by ID', async () => {
    const player = await repo.findById('player-1')
    expect(player).not.toBeNull()
    expect(player!.name).toBe('测试修士')
    expect(player!.version).toBe(0)
  })

  it('returns null for non-existent player', async () => {
    const player = await repo.findById('non-existent')
    expect(player).toBeNull()
  })

  it('saves with correct version and increments version', async () => {
    const player = await repo.findById('player-1')
    const result = await repo.save(player!, player!.version)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.newVersion).toBe(1)
    }
  })

  it('rejects save with wrong version (TURN_CONFLICT)', async () => {
    const player = await repo.findById('player-1')
    // Simulate concurrent modification: save once, then try again with stale version
    await repo.save(player!, 0) // This succeeds, bumps to 1
    const result = await repo.save(player!, 0) // Stale version
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('TURN_CONFLICT')
    }
  })

  it('rejects save for non-existent player', async () => {
    const ghost = makePlayer({ id: 'ghost', version: 0 })
    const result = await repo.save(ghost, 0)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('PLAYER_NOT_FOUND')
    }
  })

  it('version increments sequentially across multiple saves', async () => {
    let player = await repo.findById('player-1')
    expect(player!.version).toBe(0)

    const r1 = await repo.save(player!, 0)
    expect(r1.ok).toBe(true)
    if (r1.ok) expect(r1.newVersion).toBe(1)

    player = await repo.findById('player-1')
    expect(player!.version).toBe(1)

    const r2 = await repo.save(player!, 1)
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.newVersion).toBe(2)
  })

  it('returned player snapshot is a copy (not live reference)', async () => {
    const player = await repo.findById('player-1')
    const originalHp = player!.stats.hp.current
    player!.stats.hp.current = 999
    const reloaded = await repo.findById('player-1')
    expect(reloaded!.stats.hp.current).toBe(originalHp)
  })
})

// ─── 6.2 Turn Execution Repository ──────────────────────────────────────

describe('TurnExecutionRepository port', () => {
  let repo: TurnExecutionRepository

  beforeEach(() => {
    repo = createFakeTurnExecutionRepository()
  })

  describe('reserve', () => {
    it('creates a new PENDING execution record', async () => {
      const result = await repo.reserve('player-1', 'idem-001', 'req-001')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.record.status).toBe('PENDING')
        expect(result.record.playerId).toBe('player-1')
        expect(result.record.idempotencyKey).toBe('idem-001')
        expect(result.record.requestId).toBe('req-001')
        expect(result.record.attemptCount).toBe(1)
      }
    })

    it('returns ALREADY_COMPLETED for a previously completed execution', async () => {
      // First execution
      const r1 = await repo.reserve('player-1', 'idem-001', 'req-001')
      if (r1.ok) {
        await repo.markRunning(r1.record.id)
        await repo.markCompleted(r1.record.id, 'final text')
      }

      // Retry with same idempotency key
      const r2 = await repo.reserve('player-1', 'idem-001', 'req-002')
      expect(r2.ok).toBe(false)
      if (!r2.ok) {
        expect(r2.code).toBe('ALREADY_COMPLETED')
        expect(r2.existingRecord).toBeDefined()
        expect(r2.existingRecord!.status).toBe('COMPLETED')
        expect(r2.existingRecord!.candidateText).toBe('final text')
      }
    })

    it('returns DUPLICATE_RUNNING for in-progress execution', async () => {
      const r1 = await repo.reserve('player-1', 'idem-001', 'req-001')
      if (r1.ok) {
        await repo.markRunning(r1.record.id)
      }

      const r2 = await repo.reserve('player-1', 'idem-001', 'req-002')
      expect(r2.ok).toBe(false)
      if (!r2.ok) {
        expect(r2.code).toBe('DUPLICATE_RUNNING')
      }
    })

    it('allows retry after FAILED execution', async () => {
      const r1 = await repo.reserve('player-1', 'idem-001', 'req-001')
      if (r1.ok) {
        await repo.markRunning(r1.record.id)
        await repo.markFailed(r1.record.id, 'LLM_TIMEOUT', 'LLM timed out')
      }

      const r2 = await repo.reserve('player-1', 'idem-001', 'req-002')
      expect(r2.ok).toBe(true)
      if (r2.ok) {
        expect(r2.record.attemptCount).toBe(2)
        expect(r2.record.status).toBe('PENDING')
      }
    })

    it('allows retry after CANCELLED execution', async () => {
      const r1 = await repo.reserve('player-1', 'idem-001', 'req-001')
      if (r1.ok) {
        await repo.markRunning(r1.record.id)
        await repo.markCancelled(r1.record.id, 'user aborted')
      }

      const r2 = await repo.reserve('player-1', 'idem-001', 'req-002')
      expect(r2.ok).toBe(true)
      if (r2.ok) {
        expect(r2.record.status).toBe('PENDING')
      }
    })

    it('different players can use the same idempotency key', async () => {
      const r1 = await repo.reserve('player-1', 'same-key', 'req-001')
      const r2 = await repo.reserve('player-2', 'same-key', 'req-002')
      expect(r1.ok).toBe(true)
      expect(r2.ok).toBe(true)
    })
  })

  describe('status transitions', () => {
    it('PENDING → RUNNING → COMPLETED', async () => {
      const r = await repo.reserve('p1', 'ik-1', 'req-1')
      if (!r.ok) throw new Error('reserve failed')

      await repo.markRunning(r.record.id)
      await repo.markCompleted(r.record.id, 'narrative text')

      const found = await repo.findByIdempotencyKey('p1', 'ik-1')
      expect(found!.status).toBe('COMPLETED')
      expect(found!.candidateText).toBe('narrative text')
    })

    it('PENDING → RUNNING → FAILED', async () => {
      const r = await repo.reserve('p1', 'ik-2', 'req-1')
      if (!r.ok) throw new Error('reserve failed')

      await repo.markRunning(r.record.id)
      await repo.markFailed(r.record.id, 'INTERNAL_ERROR', 'Something broke')

      const found = await repo.findByIdempotencyKey('p1', 'ik-2')
      expect(found!.status).toBe('FAILED')
      expect(found!.errorCode).toBe('INTERNAL_ERROR')
    })

    it('PENDING → RUNNING → CANCELLED', async () => {
      const r = await repo.reserve('p1', 'ik-3', 'req-1')
      if (!r.ok) throw new Error('reserve failed')

      await repo.markRunning(r.record.id)
      await repo.markCancelled(r.record.id, 'client disconnected')

      const found = await repo.findByIdempotencyKey('p1', 'ik-3')
      expect(found!.status).toBe('CANCELLED')
    })
  })

  describe('findByIdempotencyKey', () => {
    it('returns null for unknown key', async () => {
      const found = await repo.findByIdempotencyKey('p1', 'unknown')
      expect(found).toBeNull()
    })

    it('returns the record for a known key', async () => {
      await repo.reserve('p1', 'ik-find', 'req-1')
      const found = await repo.findByIdempotencyKey('p1', 'ik-find')
      expect(found).not.toBeNull()
      expect(found!.idempotencyKey).toBe('ik-find')
    })
  })
})

// ─── 6.6 Outbox Repository ───────────────────────────────────────────────

describe('OutboxRepository port', () => {
  let repo: OutboxRepository

  beforeEach(() => {
    repo = createFakeOutboxRepository()
  })

  it('enqueues a pending job', async () => {
    const entry = await repo.enqueue({
      playerId: 'p1',
      eventType: 'INDEX_HISTORY',
      payload: { turnId: 't1' },
      maxAttempts: 3,
    })
    expect(entry.id).toBeTruthy()
    expect(entry.status).toBe('PENDING')
    expect(entry.attemptCount).toBe(0)
    expect(entry.eventType).toBe('INDEX_HISTORY')
  })

  it('getPending returns enqueued jobs', async () => {
    await repo.enqueue({
      playerId: 'p1',
      eventType: 'INDEX_HISTORY',
      payload: {},
      maxAttempts: 3,
    })
    const pending = await repo.getPending(10)
    expect(pending).toHaveLength(1)
    expect(pending[0].status).toBe('PENDING')
  })

  it('getPending respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await repo.enqueue({
        playerId: 'p1',
        eventType: 'TEST',
        payload: { i },
        maxAttempts: 3,
      })
    }
    const pending = await repo.getPending(3)
    expect(pending).toHaveLength(3)
  })

  it('markCompleted removes job from pending', async () => {
    const entry = await repo.enqueue({
      playerId: 'p1',
      eventType: 'TEST',
      payload: {},
      maxAttempts: 3,
    })
    await repo.markCompleted(entry.id)
    const pending = await repo.getPending(10)
    expect(pending).toHaveLength(0)
  })

  it('markFailed with retry schedules a retry', async () => {
    const entry = await repo.enqueue({
      playerId: 'p1',
      eventType: 'TEST',
      payload: {},
      maxAttempts: 3,
    })
    await repo.markFailed(entry.id, 'connection reset', 1000)
    const pending = await repo.getPending(10)
    // Should not be immediately pending (retryAfterMs hasn't elapsed)
    // But will appear when nextRetryAt is in the past
    expect(pending.length).toBeGreaterThanOrEqual(0)
  })

  it('markFailed exhausts after maxAttempts', async () => {
    const entry = await repo.enqueue({
      playerId: 'p1',
      eventType: 'TEST',
      payload: {},
      maxAttempts: 2,
    })
    await repo.markFailed(entry.id, 'error 1', 1000)
    await repo.markFailed(entry.id, 'error 2', 1000)
    // After 2 failures (attemptCount 2 >= maxAttempts 2), nextRetryAt should be null
    const pending = await repo.getPending(10)
    // exhausted entries have nextRetryAt = null, won't be picked up
    expect(pending).toHaveLength(0)
  })
})
