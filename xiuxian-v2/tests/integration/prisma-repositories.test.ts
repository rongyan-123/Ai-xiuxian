/**
 * Integration tests for Prisma repository implementations.
 *
 * These tests run against the real PostgreSQL test database (xiuxian_test).
 * They validate that the repository implementations work correctly with
 * the actual database — persistence, concurrency, consistency, transactions.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  createPrismaPlayerRepository,
  createPrismaTurnExecutionRepository,
  createPrismaOutboxRepository,
} from '@/server/infrastructure/prisma-repositories'
import { commitGameTurn, rollbackGameTurn } from '@/server/infrastructure/transaction'
import type {
  PlayerRepository,
  PlayerSnapshot,
  TurnExecutionRepository,
  OutboxRepository,
} from '@/server/infrastructure/ports'

// ─── Test Database Setup ──────────────────────────────────────────────────

const TEST_DB_URL = 'postgresql://postgres:password@localhost:5433/xiuxian_test?schema=public'

let prisma: PrismaClient
let playerRepo: PlayerRepository
let turnRepo: TurnExecutionRepository
let outboxRepo: OutboxRepository

beforeAll(async () => {
  prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DB_URL) })
  playerRepo = createPrismaPlayerRepository(prisma)
  turnRepo = createPrismaTurnExecutionRepository(prisma)
  outboxRepo = createPrismaOutboxRepository(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  // Clean test data between tests
  await prisma.outboxRecord.deleteMany()
  await prisma.gameTurnExecution.deleteMany()
  await prisma.chatMessage.deleteMany()
  await prisma.conversationSummary.deleteMany()
  await prisma.player.deleteMany()
})

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeTestPlayer(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    id: `player-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'ALIVE',
    name: '测试修士',
    gender: '男',
    version: 0,
    stats: {
      hp: { current: 100, max: 100, status_desc: '健康' },
      mp: { current: 50, max: 50, status_desc: '充足' },
      spirit: { value: 5, desc: '凡识' },
      realm: '练气期一层',
      age: { current: 18, max: 120 },
      race: '人族',
      alignment: '正道' as const,
      sect: '散修',
      spiritual_root: '金灵根',
      mental_state: '正常',
      reputation: 0,
      emotion: '平静',
      state_of_mind: 80,
      fortune: 50,
      karma: 0,
      techniques: { main: '基础吐纳', combat: [], movement: '步行', support: [] },
      shield: { current: 0, max: 50 },
      talents: [],
      traits: [],
    },
    inventory: [{ id: 'item-1', name: '灵石', count: 100, type: 'material', grade: 'common', description: '货币', value: 10 }],
    codex: [],
    relationships: {},
    situations: [],
    foreshadowings: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

async function seedPlayer(snapshot: PlayerSnapshot): Promise<void> {
  await prisma.player.create({
    data: {
      id: snapshot.id,
      status: snapshot.status,
      name: snapshot.name,
      gender: snapshot.gender,
      version: snapshot.version,
      stats: snapshot.stats as any,
      inventory: snapshot.inventory as any,
      codex: snapshot.codex as any,
      relationships: snapshot.relationships as any,
      situations: snapshot.situations as any,
      foreshadowings: snapshot.foreshadowings as any,
    },
  })
}

// ─── Player Repository ────────────────────────────────────────────────────

describe('Integration: PrismaPlayerRepository', () => {
  it('findById returns null for non-existent player', async () => {
    const result = await playerRepo.findById('non-existent-id')
    expect(result).toBeNull()
  })

  it('findById returns player snapshot for existing player', async () => {
    const player = makeTestPlayer()
    await seedPlayer(player)

    const result = await playerRepo.findById(player.id)
    expect(result).not.toBeNull()
    expect(result!.id).toBe(player.id)
    expect(result!.name).toBe('测试修士')
    expect(result!.status).toBe('ALIVE')
    expect(result!.version).toBe(0)
  })

  it('findById returns full player data including inventory and stats', async () => {
    const player = makeTestPlayer()
    await seedPlayer(player)

    const result = await playerRepo.findById(player.id)
    expect(result!.stats.hp.current).toBe(100)
    expect(result!.stats.realm).toBe('练气期一层')
    expect(result!.inventory).toHaveLength(1)
    expect(result!.inventory[0].name).toBe('灵石')
  })

  it('save creates a new player via upsert-like updateMany', async () => {
    const player = makeTestPlayer()
    await seedPlayer(player)

    const updated = { ...player, name: '进阶修士', version: 0 }
    const result = await playerRepo.save(updated, 0)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.newVersion).toBe(1)
    }

    const reloaded = await playerRepo.findById(player.id)
    expect(reloaded!.name).toBe('进阶修士')
    expect(reloaded!.version).toBe(1)
  })

  it('save rejects when version does not match (optimistic concurrency)', async () => {
    const player = makeTestPlayer()
    await seedPlayer(player)

    // Try to save with wrong version
    const result = await playerRepo.save(player, 999)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('TURN_CONFLICT')
    }
  })

  it('save returns PLAYER_NOT_FOUND for non-existent player', async () => {
    const player = makeTestPlayer()
    // Do NOT seed — player doesn't exist

    const result = await playerRepo.save(player, 0)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('PLAYER_NOT_FOUND')
    }
  })

  it('concurrent saves with correct versions succeed in sequence', async () => {
    const player = makeTestPlayer()
    await seedPlayer(player)

    // First save with version 0
    const r1 = await playerRepo.save({ ...player, name: 'v1', version: 0 }, 0)
    expect(r1.ok).toBe(true)

    // Second save with version 1
    const r2 = await playerRepo.save({ ...player, name: 'v2', version: 1 }, 1)
    expect(r2.ok).toBe(true)

    const reloaded = await playerRepo.findById(player.id)
    expect(reloaded!.name).toBe('v2')
    expect(reloaded!.version).toBe(2)
  })
})

// ─── Turn Execution Repository ────────────────────────────────────────────

describe('Integration: PrismaTurnExecutionRepository', () => {
  const playerId = 'player-turn-test'

  beforeEach(async () => {
    // Seed a player for the turn tests
    await seedPlayer(makeTestPlayer({ id: playerId }))
  })

  it('reserve creates a new execution record', async () => {
    const result = await turnRepo.reserve(playerId, 'idem-001', 'req-001')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.record.playerId).toBe(playerId)
      expect(result.record.idempotencyKey).toBe('idem-001')
      expect(result.record.status).toBe('PENDING')
      expect(result.record.attemptCount).toBe(1)
    }
  })

  it('reserve returns DUPLICATE_RUNNING for concurrent turn', async () => {
    await turnRepo.reserve(playerId, 'idem-002', 'req-001')

    // Try to reserve the same idempotency key again (still PENDING)
    const result = await turnRepo.reserve(playerId, 'idem-002', 'req-002')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('DUPLICATE_RUNNING')
    }
  })

  it('reserve allows retry after FAILED execution', async () => {
    const r1 = await turnRepo.reserve(playerId, 'idem-003', 'req-001')
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      await turnRepo.markFailed(r1.record.id, 'TEST_ERROR', 'Test failure')
    }

    // Should allow a new attempt with the same idempotency key
    const r2 = await turnRepo.reserve(playerId, 'idem-003', 'req-002')
    expect(r2.ok).toBe(true)
    if (r2.ok) {
      expect(r2.record.attemptCount).toBe(2)
    }
  })

  it('reserve returns ALREADY_COMPLETED for completed turn (idempotency replay)', async () => {
    const r1 = await turnRepo.reserve(playerId, 'idem-004', 'req-001')
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      await turnRepo.markCompleted(r1.record.id, '测试完成')
    }

    const r2 = await turnRepo.reserve(playerId, 'idem-004', 'req-002')
    expect(r2.ok).toBe(false)
    if (!r2.ok) {
      expect(r2.code).toBe('ALREADY_COMPLETED')
      expect(r2.existingRecord).toBeDefined()
      expect(r2.existingRecord!.candidateText).toBe('测试完成')
    }
  })

  it('markRunning transitions PENDING → RUNNING', async () => {
    const r1 = await turnRepo.reserve(playerId, 'idem-005', 'req-001')
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      await turnRepo.markRunning(r1.record.id)

      const record = await turnRepo.findByIdempotencyKey(playerId, 'idem-005')
      expect(record).not.toBeNull()
      expect(record!.status).toBe('RUNNING')
    }
  })

  it('markCompleted sets status and candidateText', async () => {
    const r1 = await turnRepo.reserve(playerId, 'idem-006', 'req-001')
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      await turnRepo.markCompleted(r1.record.id, '修仙世界欢迎你')

      const record = await turnRepo.findByIdempotencyKey(playerId, 'idem-006')
      expect(record!.status).toBe('COMPLETED')
      expect(record!.candidateText).toBe('修仙世界欢迎你')
    }
  })

  it('markFailed records error details', async () => {
    const r1 = await turnRepo.reserve(playerId, 'idem-007', 'req-001')
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      await turnRepo.markFailed(r1.record.id, 'LLM_TIMEOUT', 'Request exceeded 60s')

      const record = await turnRepo.findByIdempotencyKey(playerId, 'idem-007')
      expect(record!.status).toBe('FAILED')
      expect(record!.errorCode).toBe('LLM_TIMEOUT')
      expect(record!.errorDetail).toBe('Request exceeded 60s')
    }
  })

  it('markCancelled records cancellation', async () => {
    const r1 = await turnRepo.reserve(playerId, 'idem-008', 'req-001')
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      await turnRepo.markCancelled(r1.record.id, 'User aborted')

      const record = await turnRepo.findByIdempotencyKey(playerId, 'idem-008')
      expect(record!.status).toBe('CANCELLED')
      expect(record!.errorDetail).toBe('User aborted')
    }
  })

  it('findByIdempotencyKey returns null for unknown key', async () => {
    const result = await turnRepo.findByIdempotencyKey(playerId, 'non-existent')
    expect(result).toBeNull()
  })
})

// ─── Outbox Repository ────────────────────────────────────────────────────

describe('Integration: PrismaOutboxRepository', () => {
  const playerId = 'player-outbox-test'

  beforeEach(async () => {
    await seedPlayer(makeTestPlayer({ id: playerId }))
  })

  it('enqueue creates an outbox record', async () => {
    const entry = await outboxRepo.enqueue({
      playerId,
      eventType: 'GAME_TURN_COMPLETED',
      payload: { turnId: 'turn-1' },
      maxAttempts: 3,
    })

    expect(entry.id).toBeTruthy()
    expect(entry.status).toBe('PENDING')
    expect(entry.attemptCount).toBe(0)
    expect(entry.playerId).toBe(playerId)
    expect(entry.eventType).toBe('GAME_TURN_COMPLETED')
    expect(entry.payload).toEqual({ turnId: 'turn-1' })
  })

  it('getPending returns enqueued records', async () => {
    await outboxRepo.enqueue({
      playerId,
      eventType: 'TEST_EVENT',
      payload: { data: 'test' },
      maxAttempts: 3,
    })

    const pending = await outboxRepo.getPending(10)
    expect(pending.length).toBeGreaterThan(0)
    expect(pending[0].eventType).toBe('TEST_EVENT')
  })

  it('markCompleted updates status', async () => {
    const entry = await outboxRepo.enqueue({
      playerId,
      eventType: 'TEST_EVENT_2',
      payload: {},
      maxAttempts: 3,
    })

    await outboxRepo.markCompleted(entry.id)

    const pending = await outboxRepo.getPending(10)
    expect(pending.find(e => e.id === entry.id)).toBeUndefined()
  })

  it('markFailed increments attempt count and schedules retry', async () => {
    const entry = await outboxRepo.enqueue({
      playerId,
      eventType: 'TEST_EVENT_3',
      payload: {},
      maxAttempts: 3,
    })

    await outboxRepo.markFailed(entry.id, 'Processing error', 5000)

    // Should not appear in pending until retry time elapses
    const pending = await outboxRepo.getPending(10)
    expect(pending.find(e => e.id === entry.id)).toBeUndefined()
  })

  it('getPending respects limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await outboxRepo.enqueue({
        playerId,
        eventType: 'BATCH_TEST',
        payload: { index: i },
        maxAttempts: 3,
      })
    }

    const pending = await outboxRepo.getPending(3)
    expect(pending.length).toBeLessThanOrEqual(3)
  })
})

// ─── Transaction Helpers ──────────────────────────────────────────────────

describe('Integration: Transaction Helpers', () => {
  const playerId = 'player-tx-test'

  beforeEach(async () => {
    await seedPlayer(makeTestPlayer({ id: playerId }))
  })

  it('commitGameTurn persists player update and marks turn completed', async () => {
    const player = await playerRepo.findById(playerId)
    expect(player).not.toBeNull()

    // Create a turn execution first
    const reserveResult = await turnRepo.reserve(playerId, 'idem-tx-001', 'req-tx-001')
    expect(reserveResult.ok).toBe(true)
    const executionId = reserveResult.ok ? reserveResult.record.id : ''
    await turnRepo.markRunning(executionId)

    const updatedPlayer: PlayerSnapshot = {
      ...player!,
      name: '交易测试修士',
      stats: { ...player!.stats, realm: '练气期二层' },
    }

    const result = await commitGameTurn(
      { playerRepo, executionRepo: turnRepo, outboxRepo },
      executionId,
      updatedPlayer,
      0, // expected version
      '修炼有成，突破至练气期二层',
      [{ eventType: 'GAME_TURN_COMPLETED', payload: { playerId, runId: 'run-1' } }],
    )

    expect(result.ok).toBe(true)

    // Verify player was updated
    const reloaded = await playerRepo.findById(playerId)
    expect(reloaded!.name).toBe('交易测试修士')
    expect(reloaded!.stats.realm).toBe('练气期二层')
    expect(reloaded!.version).toBe(1)

    // Verify turn was marked completed
    const turnRecord = await turnRepo.findByIdempotencyKey(playerId, 'idem-tx-001')
    expect(turnRecord!.status).toBe('COMPLETED')
    expect(turnRecord!.candidateText).toBe('修炼有成，突破至练气期二层')
  })

  it('commitGameTurn rejects on version conflict', async () => {
    const player = await playerRepo.findById(playerId)
    expect(player).not.toBeNull()

    const reserveResult = await turnRepo.reserve(playerId, 'idem-tx-002', 'req-tx-002')
    expect(reserveResult.ok).toBe(true)
    const executionId = reserveResult.ok ? reserveResult.record.id : ''
    await turnRepo.markRunning(executionId)

    // Save with wrong version
    const result = await commitGameTurn(
      { playerRepo, executionRepo: turnRepo, outboxRepo },
      executionId,
      { ...player!, name: '冲突修士' },
      999, // wrong version
      'Should fail',
      [],
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('TURN_CONFLICT')
    }

    // Player should be unchanged
    const reloaded = await playerRepo.findById(playerId)
    expect(reloaded!.name).toBe('测试修士')
  })

  it('commitGameTurn enqueues outbox events', async () => {
    const player = await playerRepo.findById(playerId)
    expect(player).not.toBeNull()

    const reserveResult = await turnRepo.reserve(playerId, 'idem-tx-003', 'req-tx-003')
    expect(reserveResult.ok).toBe(true)
    const executionId = reserveResult.ok ? reserveResult.record.id : ''
    await turnRepo.markRunning(executionId)

    await commitGameTurn(
      { playerRepo, executionRepo: turnRepo, outboxRepo },
      executionId,
      player!,
      0,
      'Test content',
      [
        { eventType: 'EVENT_A', payload: { a: 1 } },
        { eventType: 'EVENT_B', payload: { b: 2 } },
      ],
    )

    const pending = await outboxRepo.getPending(10)
    const relevantEvents = pending.filter(e => e.playerId === playerId)
    expect(relevantEvents.length).toBe(2)
    expect(relevantEvents.map(e => e.eventType).sort()).toEqual(['EVENT_A', 'EVENT_B'])
  })

  it('rollbackGameTurn marks turn as failed and does not modify player', async () => {
    const player = await playerRepo.findById(playerId)
    expect(player).not.toBeNull()
    const originalName = player!.name

    const reserveResult = await turnRepo.reserve(playerId, 'idem-tx-004', 'req-tx-004')
    expect(reserveResult.ok).toBe(true)
    const executionId = reserveResult.ok ? reserveResult.record.id : ''
    await turnRepo.markRunning(executionId)

    await rollbackGameTurn(
      { playerRepo, executionRepo: turnRepo, outboxRepo },
      executionId,
      'ROLLBACK_TEST',
      'Intentional rollback for testing',
    )

    // Player should be unchanged
    const reloaded = await playerRepo.findById(playerId)
    expect(reloaded!.name).toBe(originalName)

    // Turn should be marked failed
    const turnRecord = await turnRepo.findByIdempotencyKey(playerId, 'idem-tx-004')
    expect(turnRecord!.status).toBe('FAILED')
    expect(turnRecord!.errorCode).toBe('ROLLBACK_TEST')
  })
})

// ─── Edge Cases ───────────────────────────────────────────────────────────

describe('Integration: Edge Cases', () => {
  it('handles player with empty inventory and codex', async () => {
    const player = makeTestPlayer({ inventory: [], codex: [] })
    await seedPlayer(player)

    const result = await playerRepo.findById(player.id)
    expect(result).not.toBeNull()
    expect(result!.inventory).toEqual([])
    expect(result!.codex).toEqual([])
  })

  it('handles player with many inventory items', async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      id: `item-${i}`,
      name: `物品${i}`,
      count: i + 1,
      type: 'material' as const,
      grade: 'common' as const,
      desc: `测试物品${i}`,
    }))
    const player = makeTestPlayer({ inventory: items })
    await seedPlayer(player)

    const result = await playerRepo.findById(player.id)
    expect(result!.inventory).toHaveLength(50)
  })

  it('handles player with complex relationships', async () => {
    const player = makeTestPlayer({
      relationships: {
        'npc-1': 80,
        'npc-2': -20,
        'npc-3': 50,
      },
    })
    await seedPlayer(player)

    const result = await playerRepo.findById(player.id)
    expect(result!.relationships).toEqual({
      'npc-1': 80,
      'npc-2': -20,
      'npc-3': 50,
    })
  })

  it('handles race condition: concurrent reservations for same player', async () => {
    const playerId = 'player-race-test'
    await seedPlayer(makeTestPlayer({ id: playerId }))

    // Simulate concurrent reservation attempts
    const results = await Promise.all([
      turnRepo.reserve(playerId, 'idem-race-1', 'req-race-1'),
      turnRepo.reserve(playerId, 'idem-race-2', 'req-race-2'),
      turnRepo.reserve(playerId, 'idem-race-3', 'req-race-3'),
    ])

    // All should succeed (different idempotency keys)
    const allOk = results.every(r => r.ok)
    expect(allOk).toBe(true)
  })

  it('handles idempotency: same key, different requestId', async () => {
    const playerId = 'player-idem-test'
    await seedPlayer(makeTestPlayer({ id: playerId }))

    // First reservation
    const r1 = await turnRepo.reserve(playerId, 'idem-same', 'req-first')
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      await turnRepo.markCompleted(r1.record.id, 'First completion')
    }

    // Second reservation with same key — should return ALREADY_COMPLETED
    const r2 = await turnRepo.reserve(playerId, 'idem-same', 'req-second')
    expect(r2.ok).toBe(false)
    if (!r2.ok) {
      expect(r2.code).toBe('ALREADY_COMPLETED')
      expect(r2.existingRecord!.candidateText).toBe('First completion')
    }
  })
})
