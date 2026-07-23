/**
 * Centralized sensitive-field redaction for logs, traces, and error responses.
 *
 * Uses a configurable list of sensitive field names and aliases.
 * Redaction is recursive and non-mutating.
 */
export interface RedactionConfig {
  sensitiveFields: string[]
  sensitiveAliases: string[]
  replacement: string
}

const DEFAULT_CONFIG: RedactionConfig = {
  sensitiveFields: ['apiKey', 'apikey', 'authorization', 'cookie', 'prompt'],
  sensitiveAliases: ['secret', 'token', 'password', 'credential', 'key'],
  replacement: '[REDACTED]',
}

/** All sensitive names lowercased for case-insensitive matching */
function buildSensitiveSet(config: RedactionConfig): Set<string> {
  const s = new Set<string>()
  for (const f of config.sensitiveFields) s.add(f.toLowerCase())
  for (const a of config.sensitiveAliases) s.add(a.toLowerCase())
  return s
}

export function redact<T>(
  value: T,
  config: RedactionConfig = DEFAULT_CONFIG,
): T {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value

  const sensitive = buildSensitiveSet(config)

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, config)) as unknown as T
  }

  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const keyLower = key.toLowerCase()
    const isSensitive = sensitive.has(keyLower) ||
      // Check if any sensitive field name appears as a substring
      config.sensitiveFields.some((f) => keyLower.includes(f.toLowerCase())) ||
      // Check if any alias appears as a substring of the key
      config.sensitiveAliases.some((a) => keyLower.includes(a.toLowerCase()))

    if (isSensitive) {
      result[key] = config.replacement
    } else if (val !== null && typeof val === 'object') {
      result[key] = redact(val, config)
    } else {
      result[key] = val
    }
  }

  return result as T
}

/**
 * Replace the password portion of a database URL or API key in query strings.
 */
export function redactUrl(url: string): string {
  if (!url || typeof url !== 'string') return url

  return url
    // Database URL password: postgresql://user:password@host/db
    .replace(/(\/\/[^:]+):([^@]+)@/, '$1:[REDACTED]@')
    // API key query params: ?api_key=secret &key=secret
    .replace(/([?&])(api_key|apikey|key|token|secret|password)=[^&]+/gi, '$1$2=[REDACTED]')
}

/**
 * Redact the credential portion of an Authorization header value.
 */
export function redactAuthHeader(value: string | undefined): string | undefined {
  if (!value) return value
  // Redact Bearer/Token values
  if (/^Bearer\s+/i.test(value)) return 'Bearer [REDACTED]'
  if (/^Basic\s+/i.test(value)) return 'Basic [REDACTED]'
  return value
}
