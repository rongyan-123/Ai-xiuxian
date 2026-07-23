/**
 * Game-action request/response schemas.
 */
import { z } from 'zod/v4'
import { PlayerSnapshotSchema } from './player'

// ── Game Action Request ────────────────────────────────────────────────

export const GameActionRequestSchema = z.strictObject({
  input: z.string().min(1),
  playerId: z.string().min(1),
  mode: z.enum(['action', 'prepare']).optional(),
  playerName: z.string().optional(),
  idempotencyKey: z.string().optional(),
})

export type GameActionRequest = z.infer<typeof GameActionRequestSchema>

// ── Game Turn Result ───────────────────────────────────────────────────

export const GameTurnSuccessSchema = z.object({
  reply: z.string(),
  player: PlayerSnapshotSchema,
  deltas: z.record(z.string(), z.unknown()),
})

export type GameTurnSuccess = z.infer<typeof GameTurnSuccessSchema>

// ── Player Read Response ───────────────────────────────────────────────

export const PlayerResponseSchema = z.object({
  player: PlayerSnapshotSchema,
})

export type PlayerResponse = z.infer<typeof PlayerResponseSchema>

// ── Player Delete Response ─────────────────────────────────────────────

export const PlayerDeleteResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
})
