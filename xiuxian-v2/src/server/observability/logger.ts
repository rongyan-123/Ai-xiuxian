/**
 * Centralized structured logging with automatic redaction.
 *
 * Every log entry is a flat JSON object with at minimum:
 *   service, level, message, timestamp
 *
 * When a request context is passed, requestId and runId are merged in.
 * All object values are redacted before emission.
 */
import { redact, type RedactionConfig } from './redaction'
import type { RequestContext } from './request-context'

export interface LoggerConfig {
  service: string
  level?: 'debug' | 'info' | 'warn' | 'error'
  write?: (entry: Record<string, unknown>) => void
}

export interface Logger {
  readonly serviceName: string
  readonly level: string
  debug(message: string, extra?: LogContext): void
  info(message: string, extra?: LogContext): void
  warn(message: string, extra?: LogContext): void
  error(message: string, extra?: LogContext): void
}

export interface LogContext {
  requestContext?: RequestContext
  err?: Error
  [key: string]: unknown
}

const LOG_LEVELS: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

export function createLogger(config: LoggerConfig): Logger {
  const level = config.level ?? 'info'
  const write = config.write ?? defaultWrite

  function shouldEmit(targetLevel: string): boolean {
    return LOG_LEVELS[targetLevel] >= LOG_LEVELS[level]
  }

  function emit(entryLevel: string, message: string, extra?: LogContext): void {
    if (!shouldEmit(entryLevel)) return

    const entry: Record<string, unknown> = {
      service: config.service,
      level: entryLevel,
      message,
      timestamp: new Date().toISOString(),
    }

    if (extra) {
      const { requestContext, err, ...rest } = extra

      if (requestContext) {
        entry.requestId = requestContext.requestId
        entry.runId = requestContext.runId
      }

      if (err) {
        entry.error = serializeError(err)
      }

      // Merge remaining fields with redaction
      const redacted = redact(rest)
      Object.assign(entry, redacted)
    }

    write(entry)
  }

  return {
    serviceName: config.service,
    level,
    debug: (message, extra) => emit('debug', message, extra),
    info: (message, extra) => emit('info', message, extra),
    warn: (message, extra) => emit('warn', message, extra),
    error: (message, extra) => emit('error', message, extra),
  }
}

function defaultWrite(entry: Record<string, unknown>): void {
  const line = JSON.stringify(entry)
  if (entry.level === 'error' || entry.level === 'warn') {
    process.stderr.write(line + '\n')
  } else {
    process.stdout.write(line + '\n')
  }
}

function serializeError(err: Error): Record<string, unknown> {
  const serialized: Record<string, unknown> = {
    name: err.name,
    message: err.message,
  }
  if (err.stack) {
    serialized.stack = err.stack
  }
  if (err.cause) {
    if (err.cause instanceof Error) {
      serialized.cause = serializeError(err.cause)
    } else {
      serialized.cause = String(err.cause)
    }
  }
  return serialized
}
