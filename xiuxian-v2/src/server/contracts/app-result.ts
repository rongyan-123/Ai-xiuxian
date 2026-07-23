/**
 * Typed application result and error representation.
 *
 * All expected failures use AppResult; unexpected exceptions are thrown
 * and caught by the outermost boundary for sanitized 500 responses.
 */
import type { ErrorCode } from './problem-details'
import { errorCodeToStatus, retryableCodes } from './problem-details'

// ── AppError ───────────────────────────────────────────────────────────

export interface AppError {
  /** Stable machine-readable error code */
  code: ErrorCode
  /** HTTP status code */
  status: number
  /** Human-readable detail (NOT for client branching) */
  detail: string
  /** Whether the client may retry the same request */
  retryable: boolean
  /** Internal cause — logged but never exposed to the client */
  cause?: unknown
}

// ── AppResult<T> ───────────────────────────────────────────────────────

export type AppResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AppError }

// ── Constructors ───────────────────────────────────────────────────────

export function ok<T>(value: T): AppResult<T> {
  return { ok: true, value }
}

export function err<T = never>(err: AppError): AppResult<T> {
  return { ok: false, error: err }
}

// ── Error factory ──────────────────────────────────────────────────────

export function appError(
  code: ErrorCode,
  detail: string,
  cause?: unknown,
): AppError {
  return {
    code,
    status: errorCodeToStatus[code] ?? 500,
    detail,
    retryable: retryableCodes.has(code),
    cause,
  }
}

// ── Common errors ──────────────────────────────────────────────────────

export const Errors = {
  validation: (detail: string) =>
    appError('VALIDATION_ERROR' as ErrorCode, detail),

  malformedJson: (detail: string) =>
    appError('MALFORMED_JSON' as ErrorCode, detail),

  notFound: (resource: string) =>
    appError('NOT_FOUND' as ErrorCode, `${resource} not found`),

  playerNotFound: (playerId: string) =>
    appError('PLAYER_NOT_FOUND' as ErrorCode, `Player ${playerId} not found`),

  turnConflict: (detail: string) =>
    appError('TURN_CONFLICT' as ErrorCode, detail),

  turnInProgress: () =>
    appError('TURN_IN_PROGRESS' as ErrorCode, 'A turn is already in progress for this player'),

  turnAlreadyCompleted: () =>
    appError('TURN_ALREADY_COMPLETED' as ErrorCode, 'This turn was already completed'),

  internal: (cause?: unknown) =>
    appError('INTERNAL_ERROR' as ErrorCode, 'An unexpected error occurred', cause),

  llmTimeout: (cause?: unknown) =>
    appError('LLM_TIMEOUT' as ErrorCode, 'LLM call exceeded deadline', cause),

  llmAuthError: (cause?: unknown) =>
    appError('LLM_AUTH_ERROR' as ErrorCode, 'LLM provider authentication failed', cause),

  llmProtocolError: (detail: string, cause?: unknown) =>
    appError('LLM_PROTOCOL_ERROR' as ErrorCode, detail, cause),

  llmRateLimited: (cause?: unknown) =>
    appError('LLM_RATE_LIMITED' as ErrorCode, 'LLM provider rate limited', cause),

  llmUnavailable: (cause?: unknown) =>
    appError('LLM_UNAVAILABLE' as ErrorCode, 'LLM provider unavailable', cause),

  ragUnavailable: (cause?: unknown) =>
    appError('RAG_UNAVAILABLE' as ErrorCode, 'RAG service unavailable', cause),

  ragProtocolError: (detail: string, cause?: unknown) =>
    appError('RAG_PROTOCOL_ERROR' as ErrorCode, detail, cause),

  dbUnavailable: (cause?: unknown) =>
    appError('DB_UNAVAILABLE' as ErrorCode, 'Database unavailable', cause),

  dbTimeout: (cause?: unknown) =>
    appError('DB_TIMEOUT' as ErrorCode, 'Database operation timed out', cause),

  dependencyTimeout: (dependency: string, cause?: unknown) =>
    appError('DEPENDENCY_TIMEOUT' as ErrorCode, `${dependency} timed out`, cause),

  dependencyUnavailable: (dependency: string, cause?: unknown) =>
    appError('DEPENDENCY_UNAVAILABLE' as ErrorCode, `${dependency} unavailable`, cause),
}

// ── Type guard ─────────────────────────────────────────────────────────

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'status' in value &&
    'detail' in value &&
    'retryable' in value
  )
}
