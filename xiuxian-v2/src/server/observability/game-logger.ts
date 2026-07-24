/**
 * Game Agent structured logging — JSONL file output + console.
 *
 * Builds on the base observability logger, adding file persistence
 * and game-specific event type tracking. Controlled by the
 * STRUCTURED_LOGGING feature flag.
 *
 * Log output:
 *   - Console (stdout/stderr): human-readable structured JSON
 *   - logs/agent-activity.jsonl: machine-readable event stream
 */
import * as fs from 'fs'
import * as path from 'path'
import { createLogger } from './logger'
import type { Logger, LogContext } from './logger'
import { isEnabled, FEATURES } from '../application/feature-flags'

/** Game-specific lifecycle event types for metrics aggregation */
export type GameLogEvent =
  | 'turn.accepted'
  | 'turn.rag_complete'
  | 'turn.llm_start'
  | 'turn.llm_end'
  | 'turn.tool_validation'
  | 'turn.tool_execute'
  | 'turn.commit'
  | 'turn.complete'
  | 'turn.failed'
  | 'turn.cancelled'
  | 'turn.rollback'

export interface GameLogEntry {
  timestamp: string
  event: GameLogEvent | string
  level: 'info' | 'warn' | 'error'
  requestId: string
  runId: string
  playerId?: string
  iteration?: number
  duration_ms?: number
  tool_name?: string
  tool_count?: number
  error_code?: string
  retryable?: boolean
  token_usage?: { prompt: number; completion: number; total: number }
  [key: string]: unknown
}

// ── File Logger ─────────────────────────────────────────────────────────

function getLogDir(): string {
  const dir = path.resolve(process.cwd(), 'logs')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

function getLogFilePath(): string {
  return path.join(getLogDir(), 'agent-activity.jsonl')
}

function fileWrite(entry: Record<string, unknown>): void {
  if (!isEnabled(FEATURES.STRUCTURED_LOGGING)) return
  try {
    const line = JSON.stringify(entry) + '\n'
    fs.appendFileSync(getLogFilePath(), line, 'utf-8')
  } catch {
    // File logging is non-critical; silently degrade
  }
}

// ── Game Logger ─────────────────────────────────────────────────────────

export interface GameLogger {
  readonly base: Logger
  /**
   * Log a structured game lifecycle event.
   * Merges requestId/runId from context automatically.
   */
  log(entry: GameLogEntry): void
}

export interface GameLoggerConfig {
  service: string
  level?: 'debug' | 'info' | 'warn' | 'error'
}

export function createGameLogger(config: GameLoggerConfig): GameLogger {
  const base = createLogger({
    service: config.service,
    level: config.level ?? 'info',
    // Write to both console (defaultWrite) AND file
    write: (entry) => {
      // Console output (base logger handles this via defaultWrite)
      const line = JSON.stringify(entry)
      if (entry.level === 'error' || entry.level === 'warn') {
        process.stderr.write(line + '\n')
      } else {
        process.stdout.write(line + '\n')
      }
      // File output
      fileWrite(entry)
    },
  })

  return { base, log: (entry) => emitGameLog(base, entry) }
}

function emitGameLog(base: Logger, entry: GameLogEntry): void {
  const { timestamp, event, level, requestId, runId, playerId, iteration, duration_ms, tool_name, tool_count, error_code, retryable, token_usage, ...rest } = entry

  const extra: LogContext = {
    requestContext: { requestId, runId },
    event,
    playerId,
    iteration,
    duration_ms,
    tool_name,
    tool_count,
    error_code,
    retryable,
    token_usage,
    ...rest,
  }

  switch (level) {
    case 'error': base.error(event, extra); break
    case 'warn': base.warn(event, extra); break
    default: base.info(event, extra); break
  }
}

/** No-op — kept for API compatibility. File writes are synchronous with appendFileSync. */
export function flushGameLogger(): void {
  // No streaming buffer to flush — each write is immediately persisted via appendFileSync
}
