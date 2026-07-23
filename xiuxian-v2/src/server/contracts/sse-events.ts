/**
 * Versioned SSE event protocol schemas.
 *
 * Every game-action SSE event carries a versioned envelope with:
 *   protocolVersion, requestId, runId, sequence, occurredAt, type, payload
 *
 * The envelope is a discriminated union: each `type` binds to its exact
 * validated `payload` schema. A client that validates the full SSEEvent
 * schema knows that type === 'text-delta' ⇒ payload matches TextDeltaPayload.
 *
 * Terminal events: completed, failed, cancelled (exactly one per stream)
 * First event: accepted
 */
import { z } from 'zod/v4'
import { ProblemDetailsSchema } from './problem-details'
import { PlayerSnapshotSchema } from './player'

// ── Protocol Constants ───────────────────────────────────────────────────

export const PROTOCOL_VERSION = '1.0'

export const SSEEventTypes = {
  ACCEPTED: 'accepted',
  STEP: 'step',
  TEXT_DELTA: 'text-delta',
  CODEX: 'codex',
  JOURNAL: 'journal',
  STATE_UPDATE: 'state_update',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const

export type SSEEventType = (typeof SSEEventTypes)[keyof typeof SSEEventTypes]

export const TERMINAL_EVENTS = new Set<SSEEventType>([
  SSEEventTypes.COMPLETED,
  SSEEventTypes.FAILED,
  SSEEventTypes.CANCELLED,
])

// ── Individual Payload Schemas ───────────────────────────────────────────

export const AcceptedPayloadSchema = z.object({
  requestId: z.string(),
  runId: z.string(),
  playerId: z.string(),
  mode: z.string(),
})

export const StepPayloadSchema = z.object({
  label: z.string(),
})

export const TextDeltaPayloadSchema = z.object({
  content: z.string(),
})

export const CodexPayloadSchema = z.object({
  name: z.string(),
  entry_type: z.string(),
  description: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.number(),
})

export const JournalPayloadSchema = z.object({
  title: z.string(),
  content: z.string(),
  entry_type: z.string(),
  timestamp: z.number(),
})

export const StateUpdatePayloadSchema = z.object({
  player: PlayerSnapshotSchema,
  deltas: z.record(z.string(), z.unknown()),
})

export const CompletedPayloadSchema = z.object({
  reply: z.string(),
  stats: z.record(z.string(), z.unknown()).optional(),
})

export const FailedPayloadSchema = ProblemDetailsSchema

export const CancelledPayloadSchema = z.object({
  requestId: z.string(),
  runId: z.string(),
  reason: z.string().optional(),
})

// ── Base Envelope (without payload — internal use) ───────────────────────

const envelopeBase = {
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: z.string().min(1),
  runId: z.string().min(1),
  sequence: z.number().int().min(0),
  occurredAt: z.string().datetime(),
}

// ── Per-Type Event Schemas ───────────────────────────────────────────────

const AcceptedEventSchema = z.object({
  ...envelopeBase,
  type: z.literal(SSEEventTypes.ACCEPTED),
  payload: AcceptedPayloadSchema,
})

const StepEventSchema = z.object({
  ...envelopeBase,
  type: z.literal(SSEEventTypes.STEP),
  payload: StepPayloadSchema,
})

const TextDeltaEventSchema = z.object({
  ...envelopeBase,
  type: z.literal(SSEEventTypes.TEXT_DELTA),
  payload: TextDeltaPayloadSchema,
})

const CodexEventSchema = z.object({
  ...envelopeBase,
  type: z.literal(SSEEventTypes.CODEX),
  payload: CodexPayloadSchema,
})

const JournalEventSchema = z.object({
  ...envelopeBase,
  type: z.literal(SSEEventTypes.JOURNAL),
  payload: JournalPayloadSchema,
})

const StateUpdateEventSchema = z.object({
  ...envelopeBase,
  type: z.literal(SSEEventTypes.STATE_UPDATE),
  payload: StateUpdatePayloadSchema,
})

const CompletedEventSchema = z.object({
  ...envelopeBase,
  type: z.literal(SSEEventTypes.COMPLETED),
  payload: CompletedPayloadSchema,
})

const FailedEventSchema = z.object({
  ...envelopeBase,
  type: z.literal(SSEEventTypes.FAILED),
  payload: FailedPayloadSchema,
})

const CancelledEventSchema = z.object({
  ...envelopeBase,
  type: z.literal(SSEEventTypes.CANCELLED),
  payload: CancelledPayloadSchema,
})

// ── Discriminated Union: type → payload ──────────────────────────────────

/**
 * The canonical SSE event validator. Any event that passes this schema is
 * guaranteed to have a `payload` matching its declared `type`.
 *
 * Usage:
 *   const parsed = SSEEventSchema.parse(rawEvent)
 *   // TypeScript narrows: parsed.type === 'completed' ⇒ parsed.payload.reply is string
 */
export const SSEEventSchema = z.discriminatedUnion('type', [
  AcceptedEventSchema,
  StepEventSchema,
  TextDeltaEventSchema,
  CodexEventSchema,
  JournalEventSchema,
  StateUpdateEventSchema,
  CompletedEventSchema,
  FailedEventSchema,
  CancelledEventSchema,
])

export type SSEEvent = z.infer<typeof SSEEventSchema>

// ── Legacy Envelope (backward-compatible, no payload binding) ────────────

/**
 * Simplified envelope without payload type binding.
 * Prefer the discriminated SSEEventSchema for full validation.
 */
export const SSEEventEnvelopeSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: z.string().min(1),
  runId: z.string().min(1),
  sequence: z.number().int().min(0),
  occurredAt: z.string().datetime(),
  type: z.enum(Object.values(SSEEventTypes) as [string, ...string[]]),
  payload: z.unknown(),
})

export type SSEEventEnvelope = z.infer<typeof SSEEventEnvelopeSchema>

// ── Payload Schema Map (for runtime lookup) ──────────────────────────────

export const payloadSchemaByType: Record<SSEEventType, z.ZodTypeAny> = {
  [SSEEventTypes.ACCEPTED]: AcceptedPayloadSchema,
  [SSEEventTypes.STEP]: StepPayloadSchema,
  [SSEEventTypes.TEXT_DELTA]: TextDeltaPayloadSchema,
  [SSEEventTypes.CODEX]: CodexPayloadSchema,
  [SSEEventTypes.JOURNAL]: JournalPayloadSchema,
  [SSEEventTypes.STATE_UPDATE]: StateUpdatePayloadSchema,
  [SSEEventTypes.COMPLETED]: CompletedPayloadSchema,
  [SSEEventTypes.FAILED]: FailedPayloadSchema,
  [SSEEventTypes.CANCELLED]: CancelledPayloadSchema,
}
