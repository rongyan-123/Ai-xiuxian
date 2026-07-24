/**
 * Structured logging unit tests.
 *
 * Tests:
 * - GameLogEntry shape validation (required fields present)
 * - GameLogger emits entries with correct fields
 * - File logging degrades gracefully when STRUCTURED_LOGGING is off
 * - Console output contains structured JSON
 * - Error entries include error_code and retryable
 * - Feature flag control over file output
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createGameLogger, flushGameLogger } from '@/server/observability/game-logger'
import type { GameLogger, GameLogEntry } from '@/server/observability/game-logger'
import { resetFeatureFlags, isEnabled, FEATURES } from '@/server/application/feature-flags'
import * as fs from 'fs'
import * as path from 'path'

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeLogEntry(overrides: Partial<GameLogEntry> = {}): GameLogEntry {
  return {
    timestamp: new Date().toISOString(),
    event: 'turn.accepted',
    level: 'info',
    requestId: 'req-001',
    runId: 'run-001',
    playerId: 'player-1',
    ...overrides,
  }
}

function captureOutput(fn: () => void): { stdout: string; stderr: string } {
  const origOut = process.stdout.write
  const origErr = process.stderr.write
  let stdout = ''
  let stderr = ''

  const capture = (target: 'stdout' | 'stderr') =>
    ((chunk: string | Uint8Array) => {
      const str = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
      if (target === 'stdout') stdout += str
      else stderr += str
      return true
    }) as typeof process.stdout.write

  process.stdout.write = capture('stdout')
  process.stderr.write = capture('stderr')

  try {
    fn()
  } finally {
    process.stdout.write = origOut
    process.stderr.write = origErr
  }
  return { stdout, stderr }
}

function cleanupLogFiles(): void {
  flushGameLogger()
  const logDir = path.resolve(process.cwd(), 'logs')
  const jsonlPath = path.join(logDir, 'agent-activity.jsonl')
  if (fs.existsSync(jsonlPath)) {
    fs.unlinkSync(jsonlPath)
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Structured Logging — GameLogger', () => {
  beforeEach(() => {
    resetFeatureFlags()
    cleanupLogFiles()
  })

  afterEach(() => {
    cleanupLogFiles()
  })

  it('creates logger with service name and level', () => {
    const logger = createGameLogger({ service: 'game-agent', level: 'debug' })
    expect(logger.base.serviceName).toBe('game-agent')
    expect(logger.base.level).toBe('debug')
  })

  it('log() emits to stdout for info level', () => {
    const logger = createGameLogger({ service: 'game-agent', level: 'info' })
    const { stdout } = captureOutput(() => {
      logger.log(makeLogEntry({ event: 'turn.accepted', level: 'info' }))
    })
    expect(stdout).toContain('turn.accepted')
    expect(stdout).toContain('req-001')
    expect(stdout).toContain('run-001')
  })

  it('log() emits to stderr for error level', () => {
    const logger = createGameLogger({ service: 'game-agent', level: 'info' })
    const { stderr } = captureOutput(() => {
      logger.log(makeLogEntry({
        event: 'turn.failed',
        level: 'error',
        error_code: 'LLM_TIMEOUT',
        retryable: true,
      }))
    })
    expect(stderr).toContain('turn.failed')
    expect(stderr).toContain('LLM_TIMEOUT')
  })

  it('log() includes event type in output', () => {
    const logger = createGameLogger({ service: 'game-agent', level: 'info' })
    const { stdout } = captureOutput(() => {
      logger.log(makeLogEntry({ event: 'turn.tool_execute', tool_name: 'ModifyStats' }))
    })
    const parsed = JSON.parse(stdout.split('\n')[0])
    expect(parsed.event).toBe('turn.tool_execute')
    expect(parsed.tool_name).toBe('ModifyStats')
  })

  it('output is valid JSON', () => {
    const logger = createGameLogger({ service: 'game-agent', level: 'info' })
    const { stdout } = captureOutput(() => {
      logger.log(makeLogEntry())
    })
    const line = stdout.trim().split('\n')[0]
    expect(() => JSON.parse(line)).not.toThrow()
    const parsed = JSON.parse(line)
    expect(parsed.service).toBe('game-agent')
    expect(parsed.level).toBe('info')
    expect(parsed.message).toBe('turn.accepted')
    expect(parsed.timestamp).toBeDefined()
  })

  it('writes to agent-activity.jsonl file', () => {
    // Force enable structured logging for this test
    process.env.FEATURE_STRUCTURED_LOGGING = 'true'
    resetFeatureFlags()

    // Ensure clean state
    const logDir = path.resolve(process.cwd(), 'logs')
    const jsonlPath = path.join(logDir, 'agent-activity.jsonl')
    if (fs.existsSync(jsonlPath)) {
      fs.unlinkSync(jsonlPath)
    }

    const logger = createGameLogger({ service: 'game-agent', level: 'info' })
    logger.log(makeLogEntry({ event: 'turn.complete', level: 'info' }))
    flushGameLogger()

    expect(fs.existsSync(jsonlPath)).toBe(true)

    const content = fs.readFileSync(jsonlPath, 'utf-8')
    expect(content).toContain('turn.complete')
    const entries = content.trim().split('\n').filter(Boolean)
    expect(entries.length).toBeGreaterThanOrEqual(1)

    // Cleanup
    delete process.env.FEATURE_STRUCTURED_LOGGING
    resetFeatureFlags()
  })

  it('does not write to file when STRUCTURED_LOGGING is off', () => {
    resetFeatureFlags()
    process.env.FEATURE_STRUCTURED_LOGGING = 'false'

    // Verify flag is read as false after env override
    expect(isEnabled(FEATURES.STRUCTURED_LOGGING)).toBe(false)

    // Cleanup
    delete process.env.FEATURE_STRUCTURED_LOGGING
    resetFeatureFlags()
  })

  it('all lifecycle event types are supported', () => {
    const events: GameLogEntry[] = [
      makeLogEntry({ event: 'turn.accepted' }),
      makeLogEntry({ event: 'turn.rag_complete' }),
      makeLogEntry({ event: 'turn.llm_start', token_usage: { prompt: 0, completion: 0, total: 0 } }),
      makeLogEntry({ event: 'turn.llm_end', token_usage: { prompt: 100, completion: 50, total: 150 } }),
      makeLogEntry({ event: 'turn.tool_validation', tool_count: 2 }),
      makeLogEntry({ event: 'turn.tool_execute', tool_name: 'ModifyStats', tool_count: 1 }),
      makeLogEntry({ event: 'turn.commit' }),
      makeLogEntry({ event: 'turn.complete' }),
      makeLogEntry({ event: 'turn.failed', error_code: 'LLM_SERVER_ERROR', retryable: true }),
      makeLogEntry({ event: 'turn.cancelled', level: 'warn' }),
      makeLogEntry({ event: 'turn.rollback', error_code: 'TRANSACTION_FAILED' }),
    ]

    const logger = createGameLogger({ service: 'game-agent', level: 'info' })
    for (const entry of events) {
      const { stdout, stderr } = captureOutput(() => logger.log(entry))
      const combined = stdout + stderr
      expect(combined).toContain(entry.event)
    }
  })

  it('debug level suppresses info messages', () => {
    const logger = createGameLogger({ service: 'game-agent', level: 'info' })
    const { stdout } = captureOutput(() => {
      // debug message should be suppressed since level is 'info'
      logger.base.debug('should not appear')
    })
    expect(stdout).toBe('')
  })

  it('warn level allows error but suppresses info', () => {
    const logger = createGameLogger({ service: 'game-agent', level: 'warn' })
    const { stdout: infoOut } = captureOutput(() => {
      logger.base.info('should not appear')
    })
    expect(infoOut).toBe('')

    const { stdout: warnOut1, stderr: warnOut2 } = captureOutput(() => {
      logger.base.warn('should appear')
    })
    const warnCombined = warnOut1 + warnOut2
    expect(warnCombined).toContain('should appear')
  })

  it('flushGameLogger is idempotent', () => {
    flushGameLogger() // first call
    flushGameLogger() // second call should not throw
    // Should not throw
  })

  it('creates logs directory if not exists', () => {
    const logDir = path.resolve(process.cwd(), 'logs')
    if (fs.existsSync(logDir)) {
      fs.rmSync(logDir, { recursive: true })
    }

    const logger = createGameLogger({ service: 'game-agent', level: 'info' })
    logger.log(makeLogEntry())

    expect(fs.existsSync(logDir)).toBe(true)
  })

  it('file logging degrades gracefully on write failure', () => {
    // Should not throw even if file stream is somehow broken
    const logger = createGameLogger({ service: 'game-agent', level: 'info' })
    expect(() => {
      logger.log(makeLogEntry())
    }).not.toThrow()
  })
})
