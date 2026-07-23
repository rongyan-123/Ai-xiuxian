/**
 * RFC 9457 Problem Details schema and error codes.
 * Single source of truth for all API error responses.
 */
import { z } from 'zod/v4'

// ── Problem Details (RFC 9457) ────────────────────────────────────────

export const ProblemDetailsSchema = z.object({
  type: z.string().url(),
  title: z.string(),
  status: z.number().int().min(100).max(599),
  detail: z.string(),
  instance: z.string().optional(),
  // RFC 9457 extension members
  code: z.string(),
  requestId: z.string(),
  retryable: z.boolean(),
})

export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>

export const ValidationErrorSchema = ProblemDetailsSchema.extend({
  errors: z.array(z.object({
    pointer: z.string(),
    message: z.string(),
  })).optional(),
})

export type ValidationError = z.infer<typeof ValidationErrorSchema>

// ── Stable Error Codes ─────────────────────────────────────────────────

export const ErrorCodes = {
  // 4xx — Client errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  MALFORMED_JSON: 'MALFORMED_JSON',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  PLAYER_NOT_FOUND: 'PLAYER_NOT_FOUND',
  TURN_CONFLICT: 'TURN_CONFLICT',
  TURN_IN_PROGRESS: 'TURN_IN_PROGRESS',
  TURN_ALREADY_COMPLETED: 'TURN_ALREADY_COMPLETED',
  RATE_LIMITED: 'RATE_LIMITED',

  // 5xx — Server errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  LLM_TIMEOUT: 'LLM_TIMEOUT',
  LLM_AUTH_ERROR: 'LLM_AUTH_ERROR',
  LLM_PROTOCOL_ERROR: 'LLM_PROTOCOL_ERROR',
  LLM_RATE_LIMITED: 'LLM_RATE_LIMITED',
  LLM_UNAVAILABLE: 'LLM_UNAVAILABLE',
  RAG_UNAVAILABLE: 'RAG_UNAVAILABLE',
  RAG_PROTOCOL_ERROR: 'RAG_PROTOCOL_ERROR',
  DB_UNAVAILABLE: 'DB_UNAVAILABLE',
  DB_TIMEOUT: 'DB_TIMEOUT',
  DEPENDENCY_TIMEOUT: 'DEPENDENCY_TIMEOUT',
  DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',

  // Protocol errors
  PROTOCOL_ERROR: 'PROTOCOL_ERROR',
  STREAM_INTERRUPTED: 'STREAM_INTERRUPTED',
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

// ── HTTP Status → Default Problem ──────────────────────────────────────

export const errorCodeToStatus = {
  [ErrorCodes.VALIDATION_ERROR]: 422,
  [ErrorCodes.MALFORMED_JSON]: 400,
  [ErrorCodes.UNAUTHORIZED]: 401,
  [ErrorCodes.FORBIDDEN]: 403,
  [ErrorCodes.NOT_FOUND]: 404,
  [ErrorCodes.PLAYER_NOT_FOUND]: 404,
  [ErrorCodes.TURN_CONFLICT]: 409,
  [ErrorCodes.TURN_IN_PROGRESS]: 409,
  [ErrorCodes.TURN_ALREADY_COMPLETED]: 409,
  [ErrorCodes.RATE_LIMITED]: 429,
  [ErrorCodes.INTERNAL_ERROR]: 500,
  [ErrorCodes.LLM_TIMEOUT]: 504,
  [ErrorCodes.LLM_AUTH_ERROR]: 502,
  [ErrorCodes.LLM_PROTOCOL_ERROR]: 502,
  [ErrorCodes.LLM_RATE_LIMITED]: 502,
  [ErrorCodes.LLM_UNAVAILABLE]: 503,
  [ErrorCodes.RAG_UNAVAILABLE]: 503,
  [ErrorCodes.RAG_PROTOCOL_ERROR]: 502,
  [ErrorCodes.DB_UNAVAILABLE]: 503,
  [ErrorCodes.DB_TIMEOUT]: 504,
  [ErrorCodes.DEPENDENCY_TIMEOUT]: 504,
  [ErrorCodes.DEPENDENCY_UNAVAILABLE]: 503,
  [ErrorCodes.PROTOCOL_ERROR]: 502,
  [ErrorCodes.STREAM_INTERRUPTED]: 502,
} as const satisfies Record<ErrorCode, number>

// INTERNAL_ERROR is NOT retryable: a turn may have already produced side effects
// before the unexpected exception occurred, so automatic retry could double-apply
// state mutations. The client should surface the error and let the user decide.
export const retryableCodes = new Set<ErrorCode>([
  ErrorCodes.LLM_TIMEOUT,
  ErrorCodes.LLM_RATE_LIMITED,
  ErrorCodes.LLM_UNAVAILABLE,
  ErrorCodes.RAG_UNAVAILABLE,
  ErrorCodes.DB_UNAVAILABLE,
  ErrorCodes.DB_TIMEOUT,
  ErrorCodes.DEPENDENCY_TIMEOUT,
  ErrorCodes.DEPENDENCY_UNAVAILABLE,
  ErrorCodes.RATE_LIMITED,
])
