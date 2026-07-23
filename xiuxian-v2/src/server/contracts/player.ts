/**
 * Player and inventory schemas for runtime validation at API boundaries.
 */
import { z } from 'zod/v4'

// ── Inventory Item ─────────────────────────────────────────────────────

export const InventoryItemSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  grade: z.string(),
  type: z.string(),
  description: z.string(),
  count: z.number().int().min(0),
  value: z.number(),
})

export type InventoryItem = z.infer<typeof InventoryItemSchema>

// ── Character Stats ────────────────────────────────────────────────────

export const CharacterStatsSchema = z.object({
  hp: z.object({
    current: z.number(),
    max: z.number(),
    status_desc: z.string(),
  }),
  mp: z.object({
    current: z.number(),
    max: z.number(),
    status_desc: z.string(),
  }),
  spirit: z.object({
    value: z.number(),
    desc: z.string(),
  }),
  realm: z.string(),
  age: z.object({
    current: z.number(),
    max: z.number(),
  }),
  race: z.string(),
  alignment: z.string(),
  sect: z.string(),
  spiritual_root: z.string(),
  mental_state: z.string(),
  reputation: z.number(),
  // Optional fields present in some player states
  emotion: z.string().optional(),
  state_of_mind: z.number().optional(),
  fortune: z.number().optional(),
  karma: z.number().optional(),
  shield: z.object({
    current: z.number(),
    max: z.number(),
  }).optional(),
  techniques: z.object({
    main: z.string(),
    combat: z.array(z.string()),
    movement: z.string(),
    support: z.array(z.string()),
  }).optional(),
  talents: z.array(z.string()).optional(),
  traits: z.array(z.string()).optional(),
})

export type CharacterStats = z.infer<typeof CharacterStatsSchema>

// ── Codex Entry ────────────────────────────────────────────────────────

export const CodexEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  entry_type: z.string(),
  description: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  timestamp: z.number(),
})

export type CodexEntry = z.infer<typeof CodexEntrySchema>

// ── Player Snapshot ────────────────────────────────────────────────────

export const PlayerSnapshotSchema = z.object({
  id: z.string(),
  status: z.enum(['ALIVE', 'DEAD']),
  name: z.string(),
  gender: z.string(),
  stats: CharacterStatsSchema,
  inventory: z.array(InventoryItemSchema),
  codex: z.array(CodexEntrySchema),
  relationships: z.record(z.string(), z.number()),
})

export type PlayerSnapshot = z.infer<typeof PlayerSnapshotSchema>

// ── Relationships ──────────────────────────────────────────────────────

export const RelationshipsSchema = z.record(z.string(), z.number())
