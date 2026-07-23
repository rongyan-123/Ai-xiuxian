/**
 * Redaction unit tests (TDD: RED phase).
 *
 * These tests MUST fail because @/server/observability/redaction does not exist yet.
 */
import { describe, it, expect } from 'vitest'

import {
  redact,
  redactUrl,
  redactAuthHeader,
  type RedactionConfig,
} from '@/server/observability/redaction'

describe('3.3 Redaction', () => {
  const defaultConfig: RedactionConfig = {
    sensitiveFields: ['apiKey', 'authorization', 'cookie', 'prompt'],
    sensitiveAliases: ['secret', 'token', 'password', 'credential'],
    replacement: '[REDACTED]',
  }

  describe('redact', () => {
    it('redacts top-level sensitive keys in plain objects', () => {
      const input = {
        apiKey: 'sk-abc123',
        model: 'gpt-4',
        prompt: 'hello world',
      }
      const result = redact(input, defaultConfig)
      expect(result).toEqual({
        apiKey: '[REDACTED]',
        model: 'gpt-4',
        prompt: '[REDACTED]',
      })
    })

    it('redacts nested sensitive keys recursively', () => {
      const input = {
        config: {
          apiKey: 'sk-xyz',
          timeout: 5000,
          headers: {
            authorization: 'Bearer token123',
            'content-type': 'application/json',
          },
        },
      }
      const result = redact(input, defaultConfig)
      expect((result as Record<string, unknown>).config).toEqual({
        apiKey: '[REDACTED]',
        timeout: 5000,
        headers: {
          authorization: '[REDACTED]',
          'content-type': 'application/json',
        },
      })
    })

    it('redacts in arrays', () => {
      const input = {
        messages: [
          { role: 'user', content: 'hi', apiKey: 'sk-1' },
          { role: 'assistant', content: 'hello', apiKey: 'sk-2' },
        ],
      }
      const result = redact(input, defaultConfig)
      const messages = (result as Record<string, unknown>).messages as Array<Record<string, unknown>>
      expect(messages[0].apiKey).toBe('[REDACTED]')
      expect(messages[1].apiKey).toBe('[REDACTED]')
      expect(messages[0].content).toBe('hi')
    })

    it('does not mutate the original object', () => {
      const input = { apiKey: 'sk-abc' }
      redact(input, defaultConfig)
      expect(input.apiKey).toBe('sk-abc')
    })

    it('handles null and undefined values', () => {
      expect(() => redact(null as unknown as Record<string, unknown>, defaultConfig)).not.toThrow()
      expect(() => redact(undefined as unknown as Record<string, unknown>, defaultConfig)).not.toThrow()
    })

    it('handles primitive values', () => {
      expect(redact('plain string' as unknown as Record<string, unknown>, defaultConfig)).toBe('plain string')
      expect(redact(42 as unknown as Record<string, unknown>, defaultConfig)).toBe(42)
    })

    it('redacts sensitive aliases', () => {
      const input = { secret: 's3cr3t', token: 't0k3n', name: 'normal' }
      const result = redact(input, defaultConfig)
      expect(result).toEqual({
        secret: '[REDACTED]',
        token: '[REDACTED]',
        name: 'normal',
      })
    })

    it('redacts keys case-insensitively', () => {
      const input = { ApiKey: 'sk-UPPER', apikey: 'sk-lower', APIKEY: 'sk-allcaps' }
      const result = redact(input, defaultConfig)
      expect(result).toEqual({
        ApiKey: '[REDACTED]',
        apikey: '[REDACTED]',
        APIKEY: '[REDACTED]',
      })
    })

    it('redacts cookie fields', () => {
      const input = { headers: { cookie: 'session=abc; token=xyz' } }
      const result = redact(input, defaultConfig)
      expect((result as Record<string, unknown>).headers).toEqual({
        cookie: '[REDACTED]',
      })
    })
  })

  describe('redactUrl', () => {
    it('replaces the password component in database URLs', () => {
      const url = 'postgresql://user:password123@localhost:5433/mydb'
      const result = redactUrl(url)
      expect(result).not.toContain('password123')
      expect(result).toContain('user')
      expect(result).toContain('@localhost:5433/mydb')
    })

    it('redacts API keys in URL query strings', () => {
      const url = 'https://api.example.com/v1?api_key=sk-secret123&model=gpt4'
      const result = redactUrl(url)
      expect(result).not.toContain('sk-secret123')
      expect(result).toContain('model=gpt4')
    })

    it('returns the original string for non-URL inputs', () => {
      expect(redactUrl('not a url')).toBe('not a url')
      expect(redactUrl('')).toBe('')
    })
  })

  describe('redactAuthHeader', () => {
    it('redacts Bearer tokens', () => {
      expect(redactAuthHeader('Bearer sk-abc123xyz')).toBe('Bearer [REDACTED]')
    })

    it('redacts Basic auth credentials', () => {
      expect(redactAuthHeader('Basic dXNlcjpwYXNz')).toBe('Basic [REDACTED]')
    })

    it('returns non-auth values unchanged', () => {
      expect(redactAuthHeader('application/json')).toBe('application/json')
    })

    it('handles empty values', () => {
      expect(redactAuthHeader('')).toBe('')
      expect(redactAuthHeader(undefined as unknown as string)).toBe(undefined)
    })
  })

  describe('custom redaction config', () => {
    it('supports custom replacement text', () => {
      const config: RedactionConfig = {
        sensitiveFields: ['apiKey'],
        sensitiveAliases: [],
        replacement: '***',
      }
      const result = redact({ apiKey: 'sk-abc', name: 'test' }, config)
      expect(result).toEqual({ apiKey: '***', name: 'test' })
    })

    it('allows empty sensitive fields (no redaction)', () => {
      const config: RedactionConfig = {
        sensitiveFields: [],
        sensitiveAliases: [],
        replacement: '[REDACTED]',
      }
      const result = redact({ apiKey: 'sk-abc', name: 'test' }, config)
      expect(result).toEqual({ apiKey: 'sk-abc', name: 'test' })
    })
  })
})
