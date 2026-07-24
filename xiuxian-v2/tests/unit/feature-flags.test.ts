/**
 * Feature flags unit tests.
 *
 * Tests:
 * - Default values match specification
 * - isEnabled() returns correct defaults
 * - Env var override (true/1/false/0/empty)
 * - resetFeatureFlags() clears cache
 * - getAllFlags() returns all flags
 * - Unknown env var values default to the code default
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  isEnabled,
  getAllFlags,
  resetFeatureFlags,
  FEATURES,
} from '@/server/application/feature-flags'

describe('Feature Flags — defaults', () => {
  beforeEach(() => {
    resetFeatureFlags()
    // Clear all FEATURE_ env vars
    for (const name of Object.values(FEATURES)) {
      delete process.env[`FEATURE_${name}`]
    }
  })

  afterEach(() => {
    for (const name of Object.values(FEATURES)) {
      delete process.env[`FEATURE_${name}`]
    }
  })

  it('STRUCTURED_LOGGING is on by default', () => {
    expect(isEnabled(FEATURES.STRUCTURED_LOGGING)).toBe(true)
  })

  it('GATE_ENFORCEMENT is off by default', () => {
    expect(isEnabled(FEATURES.GATE_ENFORCEMENT)).toBe(false)
  })

  it('MULTI_MODEL is off by default', () => {
    expect(isEnabled(FEATURES.MULTI_MODEL)).toBe(false)
  })

  it('NPC_SYSTEM is off by default', () => {
    expect(isEnabled(FEATURES.NPC_SYSTEM)).toBe(false)
  })

  it('KNOWLEDGE_BUBBLES is off by default', () => {
    expect(isEnabled(FEATURES.KNOWLEDGE_BUBBLES)).toBe(false)
  })

  it('getAllFlags returns all feature states', () => {
    const flags = getAllFlags()
    expect(flags.GATE_ENFORCEMENT).toBe(false)
    expect(flags.MULTI_MODEL).toBe(false)
    expect(flags.NPC_SYSTEM).toBe(false)
    expect(flags.KNOWLEDGE_BUBBLES).toBe(false)
    expect(flags.STRUCTURED_LOGGING).toBe(true)
    expect(Object.keys(flags).length).toBe(5)
  })
})

describe('Feature Flags — env var override', () => {
  beforeEach(() => {
    resetFeatureFlags()
    for (const name of Object.values(FEATURES)) {
      delete process.env[`FEATURE_${name}`]
    }
  })

  afterEach(() => {
    for (const name of Object.values(FEATURES)) {
      delete process.env[`FEATURE_${name}`]
    }
  })

  it('env var FEATURE_GATE_ENFORCEMENT=true overrides default', () => {
    process.env.FEATURE_GATE_ENFORCEMENT = 'true'
    expect(isEnabled(FEATURES.GATE_ENFORCEMENT)).toBe(true)
  })

  it('env var FEATURE_GATE_ENFORCEMENT=1 overrides default', () => {
    process.env.FEATURE_GATE_ENFORCEMENT = '1'
    expect(isEnabled(FEATURES.GATE_ENFORCEMENT)).toBe(true)
  })

  it('env var FEATURE_STRUCTURED_LOGGING=false overrides default', () => {
    process.env.FEATURE_STRUCTURED_LOGGING = 'false'
    expect(isEnabled(FEATURES.STRUCTURED_LOGGING)).toBe(false)
  })

  it('env var FEATURE_STRUCTURED_LOGGING=0 overrides default', () => {
    process.env.FEATURE_STRUCTURED_LOGGING = '0'
    expect(isEnabled(FEATURES.STRUCTURED_LOGGING)).toBe(false)
  })

  it('empty env var does not override default', () => {
    process.env.FEATURE_NPC_SYSTEM = ''
    expect(isEnabled(FEATURES.NPC_SYSTEM)).toBe(false)
  })

  it('unknown env var value (not true/1) defaults to false', () => {
    process.env.FEATURE_NPC_SYSTEM = 'yes'
    expect(isEnabled(FEATURES.NPC_SYSTEM)).toBe(false)
  })

  it('multiple flags can be overridden simultaneously', () => {
    process.env.FEATURE_GATE_ENFORCEMENT = 'true'
    process.env.FEATURE_NPC_SYSTEM = 'true'
    process.env.FEATURE_STRUCTURED_LOGGING = 'false'

    expect(isEnabled(FEATURES.GATE_ENFORCEMENT)).toBe(true)
    expect(isEnabled(FEATURES.NPC_SYSTEM)).toBe(true)
    expect(isEnabled(FEATURES.STRUCTURED_LOGGING)).toBe(false)
    // Unmodified flags stay at defaults
    expect(isEnabled(FEATURES.MULTI_MODEL)).toBe(false)
  })
})

describe('Feature Flags — cache behavior', () => {
  beforeEach(() => {
    resetFeatureFlags()
    for (const name of Object.values(FEATURES)) {
      delete process.env[`FEATURE_${name}`]
    }
  })

  afterEach(() => {
    for (const name of Object.values(FEATURES)) {
      delete process.env[`FEATURE_${name}`]
    }
  })

  it('resetFeatureFlags clears cached values', () => {
    process.env.FEATURE_GATE_ENFORCEMENT = 'true'
    expect(isEnabled(FEATURES.GATE_ENFORCEMENT)).toBe(true)

    // Reset clears cache
    resetFeatureFlags()

    // Remove env var
    delete process.env.FEATURE_GATE_ENFORCEMENT

    // Should now return default (false)
    expect(isEnabled(FEATURES.GATE_ENFORCEMENT)).toBe(false)
  })

  it('isEnabled returns consistent results (cached)', () => {
    expect(isEnabled(FEATURES.STRUCTURED_LOGGING)).toBe(true)
    // Second call should return same cached value
    expect(isEnabled(FEATURES.STRUCTURED_LOGGING)).toBe(true)
  })
})
