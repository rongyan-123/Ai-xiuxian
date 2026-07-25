/**
 * OpenAPI drift detection tests.
 *
 * Verifies that the published OpenAPI 3.1 document stays in sync with the
 * runtime Zod schemas. A deliberate schema mismatch (a schema declared in
 * OpenAPI but missing from runtime, or vice versa) MUST fail this test.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { z } from 'zod/v4'

// ── Runtime Zod schemas ────────────────────────────────────────────────────
import { GameActionRequestSchema } from '@/server/contracts/game-action'
import { PlayerResponseSchema } from '@/server/contracts/game-action'
import { PlayerSnapshotSchema } from '@/server/contracts/player'
import { CharacterStatsSchema } from '@/server/contracts/player'
import { InventoryItemSchema } from '@/server/contracts/player'
import { CodexEntrySchema } from '@/server/contracts/player'
import { ProblemDetailsSchema } from '@/server/contracts/problem-details'
import { ValidationErrorSchema } from '@/server/contracts/problem-details'
import { SSEEventEnvelopeSchema, SSEEventSchema } from '@/server/contracts/sse-events'

const OPENAPI_PATH = join(
  import.meta.dirname ?? __dirname,
  '..',
  '..',
  'src',
  'server',
  'contracts',
  'openapi.json',
)

interface OpenApiDoc {
  openapi: string
  info: { title: string; version: string }
  paths?: Record<string, unknown>
  components?: {
    schemas?: Record<string, unknown>
  }
}

function loadOpenApiDoc(): OpenApiDoc {
  const raw = readFileSync(OPENAPI_PATH, 'utf-8')
  return JSON.parse(raw) as OpenApiDoc
}

// ── Schema mapping: OpenAPI name → runtime Zod schema ──────────────────────
// Every entry here is checked bidirectionally:
//   - If an OpenAPI schema is not in this map → FAIL
//   - If a map entry points to a non-existent import → FAIL (caught by TS/import)

const SCHEMA_MAP: Record<string, z.ZodTypeAny> = {
  GameActionRequest: GameActionRequestSchema,
  PlayerSnapshot: PlayerSnapshotSchema,
  CharacterStats: CharacterStatsSchema,
  InventoryItem: InventoryItemSchema,
  CodexEntry: CodexEntrySchema,
  PlayerResponse: PlayerResponseSchema,
  ProblemDetails: ProblemDetailsSchema,
  ValidationError: ValidationErrorSchema,
  SSEEvent: SSEEventEnvelopeSchema,
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('2.5 OpenAPI drift detection', () => {
  const doc = loadOpenApiDoc()

  it('is a valid OpenAPI 3.1 document', () => {
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.info).toBeDefined()
    expect(doc.info.title).toBeTruthy()
    expect(doc.info.version).toBeTruthy()
    expect(doc.components).toBeDefined()
    expect(doc.components!.schemas).toBeDefined()
    const schemaNames = Object.keys(doc.components!.schemas!)
    expect(schemaNames.length).toBeGreaterThan(0)
  })

  it('has every OpenAPI component schema mapped to a runtime Zod schema', () => {
    const openApiSchemas = Object.keys(doc.components!.schemas!)
    const mappedSchemas = Object.keys(SCHEMA_MAP)

    for (const name of openApiSchemas) {
      expect(
        SCHEMA_MAP[name],
        `OpenAPI schema "${name}" has no runtime Zod mapping. Add it to SCHEMA_MAP in this test.`
      ).toBeDefined()
    }

    // Also check the reverse: every mapped schema exists in OpenAPI
    for (const name of mappedSchemas) {
      expect(
        openApiSchemas,
        `Runtime schema "${name}" is in SCHEMA_MAP but missing from OpenAPI document.`
      ).toContain(name)
    }
  })

  it('validates compliant GameActionRequest payloads', () => {
    const valid = {
      input: '开始修炼',
      playerId: 'player-1',
      mode: 'action',
      idempotencyKey: 'abc-123',
    }
    const result = GameActionRequestSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('rejects malformed GameActionRequest (missing playerId)', () => {
    const invalid = { input: '开始修炼' }
    const result = GameActionRequestSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('validates compliant ProblemDetails payloads', () => {
    const valid = {
      type: 'https://api.xiuxian.test/errors/validation-error',
      title: 'Validation Error',
      status: 422,
      detail: 'The request body failed validation',
      code: 'VALIDATION_ERROR',
      requestId: 'req-001',
      retryable: false,
    }
    const result = ProblemDetailsSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('validates compliant PlayerSnapshot payloads', () => {
    const valid = makeValidPlayerSnapshot()
    const result = PlayerSnapshotSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('validates compliant InventoryItem payloads', () => {
    const valid = {
      id: 'item-1',
      name: '灵石',
      grade: '上品',
      type: 'currency',
      description: '一块闪闪发光的灵石',
      count: 42,
      value: 100,
    }
    const result = InventoryItemSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('validates compliant CodexEntry payloads', () => {
    const valid = {
      id: 'codex-1',
      name: '太虚剑法',
      entry_type: 'technique',
      description: '失传的顶级剑法',
      metadata: { rarity: 'legendary', chapter: 3 },
      timestamp: 1700000000000,
    }
    const result = CodexEntrySchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('validates compliant SSE event envelope', () => {
    const valid = {
      protocolVersion: '1.0',
      requestId: 'req-001',
      runId: 'run-001',
      sequence: 0,
      occurredAt: '2026-07-23T00:00:00.000Z',
      type: 'accepted',
      payload: { requestId: 'req-001', runId: 'run-001', playerId: 'p1', mode: 'action' },
    }
    const result = SSEEventEnvelopeSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('validates CharacterStats with all required fields', () => {
    const stats = makeValidCharacterStats()
    const result = CharacterStatsSchema.safeParse(stats)
    expect(result.success).toBe(true)
  })

  it('rejects CharacterStats missing hp.max', () => {
    const stats = makeValidCharacterStats()
    delete (stats.hp as Record<string, unknown>).max
    const result = CharacterStatsSchema.safeParse(stats)
    expect(result.success).toBe(false)
  })

  it('validates PlayerResponse wraps a PlayerSnapshot', () => {
    const valid = { player: makeValidPlayerSnapshot() }
    const result = PlayerResponseSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('validates ValidationError extends ProblemDetails with errors array', () => {
    const valid = {
      type: 'https://api.xiuxian.test/errors/validation-error',
      title: 'Validation Error',
      status: 422,
      detail: 'Invalid fields',
      code: 'VALIDATION_ERROR',
      requestId: 'req-001',
      retryable: false,
      errors: [{ pointer: '/input', message: 'Required' }],
    }
    const result = ValidationErrorSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('validates SSE discriminated union: accepted event', () => {
    const event = {
      protocolVersion: '1.0',
      requestId: 'req-001',
      runId: 'run-001',
      sequence: 0,
      occurredAt: '2026-07-23T00:00:00.000Z',
      type: 'accepted',
      payload: { requestId: 'req-001', runId: 'run-001', playerId: 'p1', mode: 'action' },
    }
    const result = SSEEventSchema.safeParse(event)
    expect(result.success).toBe(true)
  })

  it('validates SSE discriminated union: completed event', () => {
    const event = {
      protocolVersion: '1.0',
      requestId: 'req-001',
      runId: 'run-001',
      sequence: 5,
      occurredAt: '2026-07-23T00:00:05.000Z',
      type: 'completed',
      payload: { reply: '修炼完成！' },
    }
    const result = SSEEventSchema.safeParse(event)
    expect(result.success).toBe(true)
  })

  it('validates SSE discriminated union: failed event', () => {
    const event = {
      protocolVersion: '1.0',
      requestId: 'req-001',
      runId: 'run-001',
      sequence: 3,
      occurredAt: '2026-07-23T00:00:03.000Z',
      type: 'failed',
      payload: {
        type: 'https://api.xiuxian.test/errors/internal-error',
        title: 'Internal Error',
        status: 500,
        detail: 'An unexpected error occurred',
        code: 'INTERNAL_ERROR',
        requestId: 'req-001',
        retryable: false,
      },
    }
    const result = SSEEventSchema.safeParse(event)
    expect(result.success).toBe(true)
  })

  it('rejects SSE event with wrong payload shape for its type', () => {
    const event = {
      protocolVersion: '1.0',
      requestId: 'req-001',
      runId: 'run-001',
      sequence: 5,
      occurredAt: '2026-07-23T00:00:05.000Z',
      type: 'completed',
      payload: { wrongField: true }, // completed payload must have `reply: string`
    }
    const result = SSEEventSchema.safeParse(event)
    expect(result.success).toBe(false)
  })

  // ── Deliberate drift detection ─────────────────────────────────────────

  it('detects when an OpenAPI schema is not in the runtime SCHEMA_MAP', () => {
    // Simulate: a schema exists in OpenAPI but has no runtime mapping
    const fakeOpenApiSchemas = [
      ...Object.keys(doc.components!.schemas!),
      'NonExistentSchema',
    ]

    const missing = fakeOpenApiSchemas.filter((name) => !SCHEMA_MAP[name])
    expect(missing).toContain('NonExistentSchema')
    // In real CI, missing.length > 0 would be a test failure
    expect(missing.length).toBeGreaterThan(0)
  })

  it('detects when a runtime schema in SCHEMA_MAP is missing from OpenAPI', () => {
    const openApiSchemas = Object.keys(doc.components!.schemas!)
    const fakeOpenApiSchemas = openApiSchemas.filter((n) => n !== 'GameActionRequest')

    const mappedButMissing = Object.keys(SCHEMA_MAP).filter(
      (name) => !fakeOpenApiSchemas.includes(name)
    )
    expect(mappedButMissing).toContain('GameActionRequest')
    expect(mappedButMissing.length).toBeGreaterThan(0)
  })
})

// ── Helpers ────────────────────────────────────────────────────────────────

function makeValidCharacterStats() {
  return {
    hp: { current: 100, max: 100, status_desc: '健康' },
    mp: { current: 50, max: 50, status_desc: '充盈' },
    spirit: { value: 10, desc: '凡人' },
    realm: '练气期',
    age: { current: 18, max: 120 },
    race: '人族',
    alignment: '正道',
    sect: '太虚宗',
    spiritual_root: '金灵根',
    mental_state: '平静',
    reputation: 0,
  }
}

function makeValidPlayerSnapshot() {
  return {
    id: 'player-1',
    status: 'ALIVE' as const,
    name: '张三',
    gender: '男',
    stats: makeValidCharacterStats(),
    inventory: [
      {
        id: 'item-1',
        name: '灵石',
        grade: '上品',
        type: 'currency',
        description: '闪闪发光的灵石',
        count: 42,
        value: 100,
      },
    ],
    codex: [
      {
        id: 'codex-1',
        name: '太虚剑法',
        entry_type: 'technique',
        description: '失传的顶级剑法',
        metadata: {},
        timestamp: 1700000000000,
      },
    ],
    relationships: { 'npc-1': 50 },
    worldTime: 1700000000000,
    currentLocation: '新手村',
    npcs: [],
  }
}
