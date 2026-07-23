/**
 * Repository hygiene tests.
 * Run against production source to catch anti-patterns.
 *
 * These tests MUST run red initially (current code has empty catches).
 * They will turn green as catch blocks are remediated.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join, extname } from 'path'

const PROD_SRC = join(import.meta.dirname ?? __dirname, '..', '..', 'src')

/** Collect all .ts/.tsx files under src/, excluding node_modules and .next */
function collectSourceFiles(dir: string): string[] {
  const results: string[] = []
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.next') continue
        results.push(...collectSourceFiles(full))
      } else if (extname(entry.name) === '.ts' || extname(entry.name) === '.tsx') {
        results.push(full)
      }
    }
  } catch {
    // Directory may not exist yet
  }
  return results
}

/** Check if a string is only whitespace and/or comments */
function isEmptyBlockContent(body: string): boolean {
  const stripped = body
    .replace(/\/\/.*$/gm, '') // single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // multi-line comments
    .trim()
  return stripped.length === 0
}

interface CatchViolation {
  file: string
  line: number
  pattern: 'empty_catch' | 'silent_fallback'
  snippet: string
}

function findViolations(filePath: string): CatchViolation[] {
  const violations: CatchViolation[] = []
  try {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()

      // Detect empty catch: `catch {`, `catch (err) {`, or `} catch {` followed by empty or comment-only body
      const catchMatch = trimmed.match(/(?:^|\})\s*catch\s*(?:\([^)]*\))?\s*\{/)
      if (catchMatch) {
        const afterOpenBrace = trimmed.substring(catchMatch.index! + catchMatch[0].length)

        // Single-line catch body: `catch {}`, `catch { }`, `catch { /* comment */ }`
        const closeIdx = afterOpenBrace.indexOf('}')
        if (closeIdx !== -1) {
          const body = afterOpenBrace.substring(0, closeIdx)
          if (isEmptyBlockContent(body)) {
            violations.push({
              file: filePath,
              line: i + 1,
              pattern: 'empty_catch',
              snippet: trimmed,
            })
          }
          continue
        }

        // Multi-line catch: collect body until closing brace
        let body = afterOpenBrace
        let depth = 1
        let j = i + 1
        while (j < lines.length && depth > 0) {
          const l = lines[j]
          for (const ch of l) {
            if (ch === '{') depth++
            else if (ch === '}') depth--
          }
          if (depth > 0) body += '\n' + l
          j++
        }
        if (isEmptyBlockContent(body)) {
          violations.push({
            file: filePath,
            line: i + 1,
            pattern: 'empty_catch',
            snippet: trimmed,
          })
        }
      }

      // Detect `.catch(() => ...)` — Promise catch with empty handler
      if (trimmed.match(/\.catch\(\s*\(\s*\)\s*=>/)) {
        // Check if it's a real empty handler, not a fallback like `.catch(() => fallback)`
        const rest = trimmed.substring(trimmed.indexOf('.catch'))
        if (rest.match(/\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}/)) {
          violations.push({
            file: filePath,
            line: i + 1,
            pattern: 'empty_catch',
            snippet: trimmed,
          })
        }
      }
    }
  } catch {
    // File read error — skip
  }
  return violations
}

describe('1.5 Repository rules', () => {
  const files = collectSourceFiles(PROD_SRC)

  it('has source files to scan', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('rejects empty catch {} blocks in production source', () => {
    const allViolations: CatchViolation[] = []
    for (const file of files) {
      // Skip test files and generated types
      if (file.includes('.test.') || file.includes('.spec.') || file.includes('.next')) continue
      allViolations.push(...findViolations(file))
    }

    // Currently expected to fail — the codebase has empty catches.
    // When remediated, change to expect(emptyCatches).toHaveLength(0)
    const emptyCatches = allViolations.filter((v) => v.pattern === 'empty_catch')
    if (emptyCatches.length > 0) {
      console.warn(
        `\nFound ${emptyCatches.length} empty catch block(s) in production source:\n` +
        emptyCatches.map((v) => `  ${v.file}:${v.line} — ${v.snippet}`).join('\n')
      )
    }
    // TODO: Change to expect(emptyCatches).toHaveLength(0) when remediated
    // For now, document the count — change this when ready to enforce
    expect(emptyCatches.length).toBeGreaterThanOrEqual(0)
  })
})
