/**
 * Feature flags for phased rollout of game Agent capabilities.
 *
 * Controlled via environment variables FEATURE_<NAME>=true/false.
 * Defaults are safe for production — only STRUCTURED_LOGGING is on by default.
 *
 * Usage:
 *   import { isEnabled, FEATURES } from '../application/feature-flags'
 *   if (isEnabled(FEATURES.GATE_ENFORCEMENT)) { ... }
 */

/** Feature flag name constants */
export const FEATURES = {
  /** Tool capability gate full enforcement (Phase 2). Default: off */
  GATE_ENFORCEMENT: 'GATE_ENFORCEMENT',
  /** Dual-model architecture — separate fast/slow LLM (Phase 3). Default: off */
  MULTI_MODEL: 'MULTI_MODEL',
  /** Autonomous NPC system with behavior trees (Phase 4). Default: off */
  NPC_SYSTEM: 'NPC_SYSTEM',
  /** Knowledge bubble constraints binding (Phase 5). Default: off */
  KNOWLEDGE_BUBBLES: 'KNOWLEDGE_BUBBLES',
  /** Structured JSONL file logging to logs/ directory. Default: on */
  STRUCTURED_LOGGING: 'STRUCTURED_LOGGING',
} as const

export type FeatureName = (typeof FEATURES)[keyof typeof FEATURES]

/** Default values — safe for current production */
const DEFAULTS: Record<FeatureName, boolean> = {
  GATE_ENFORCEMENT: false,
  MULTI_MODEL: false,
  NPC_SYSTEM: false,
  KNOWLEDGE_BUBBLES: false,
  STRUCTURED_LOGGING: true,
}

/** Resolve feature flag value. Env var overrides default. */
function resolve(name: FeatureName): boolean {
  const envKey = `FEATURE_${name}`
  const raw = process.env[envKey]
  if (raw === undefined || raw === '') return DEFAULTS[name]
  return raw.toLowerCase() === 'true' || raw === '1'
}

// Cache resolved values at module init (immutable for process lifetime)
const cache = new Map<FeatureName, boolean>()

/** Check whether a feature flag is enabled. */
export function isEnabled(name: FeatureName): boolean {
  if (!cache.has(name)) {
    cache.set(name, resolve(name))
  }
  return cache.get(name)!
}

/** Get all feature flag states (for observability). */
export function getAllFlags(): Record<FeatureName, boolean> {
  const result: Record<string, boolean> = {}
  for (const name of Object.values(FEATURES)) {
    result[name] = isEnabled(name)
  }
  return result
}

/** Reset cached flag values (for testing only). */
export function resetFeatureFlags(): void {
  cache.clear()
}
