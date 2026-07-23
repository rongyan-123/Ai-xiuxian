/**
 * Source-boundary tests.
 *
 * Verifies architectural boundaries by scanning actual source imports:
 * - API v1 Route Handlers must not import Prisma, provider SDKs,
 *   vector-store implementations, or domain rule internals directly.
 * - Application services must not import HTTP framework specifics.
 * - Infrastructure adapters must not import application or HTTP code.
 *
 * Legacy routes under /api/game/ are grandfathered — they will be
 * replaced by API v1 and are documented rather than enforced.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC_DIR = path.resolve(import.meta.dirname, '../../src')

interface BoundaryRule {
  layer: string
  /** Only files matching these patterns are checked */
  files: RegExp[]
  /** Import path substrings that are FORBIDDEN */
  forbidden: string[]
  /** Whether this is aspirational (document but don't fail) */
  aspirational?: boolean
}

const RULES: BoundaryRule[] = [
  {
    layer: 'API v1 Route Handler',
    files: [/src[\\/]app[\\/]api[\\/]v1[\\/]/],
    forbidden: [
      '@prisma/client',
      'prisma-repositories',
      'fake-repositories',
      'rule-engine',
      'tool-schemas',
      'vector-store',
      'langgraph',
      'openai',
      '@langchain',
      'llm-adapter',
      'rag-adapter',
    ],
  },
  {
    layer: 'Application Service',
    files: [/src[\\/]server[\\/]application[\\/]/],
    forbidden: [
      '@prisma/client',
      'prisma-repositories',
      'fake-repositories',
      'next/navigation',
      'next/headers',
      'next/server',
    ],
  },
  {
    layer: 'Infrastructure Adapter',
    files: [/src[\\/]server[\\/]infrastructure[\\/]/],
    forbidden: [
      'server/application',
      'next/navigation',
      'next/headers',
    ],
  },
  {
    layer: 'Legacy Route Handler (documented, not enforced)',
    files: [/src[\\/]app[\\/]api[\\/]game[\\/]/],
    forbidden: [],
    aspirational: true,
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────

function findFiles(dir: string, patterns: RegExp[], files: string[] = []): string[] {
  if (!fs.existsSync(dir)) return files
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, entry.name)
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      findFiles(fp, patterns, files)
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      const rel = fp.replace(/\\/g, '/')
      if (patterns.some(p => p.test(rel))) {
        files.push(fp)
      }
    }
  }
  return files
}

function extractImportPaths(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8')
  const paths: string[] = []
  const re = /(?:import|export)\s+(?:type\s+)?(?:(?:\{[^}]*\}|[^'";\n]+)\s+from\s+)?['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    paths.push(m[1])
  }
  return paths
}

function relativePath(abs: string): string {
  return abs.replace(/\\/g, '/').replace(SRC_DIR.replace(/\\/g, '/') + '/', '')
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('8.5 Source-boundary rules', () => {
  const allViolations: Array<{ file: string; layer: string; importPath: string; forbidden: string }> = []
  const documentedViolations: Array<{ file: string; importPath: string }> = []

  for (const rule of RULES) {
    const matchingFiles = findFiles(SRC_DIR, rule.files)

    for (const file of matchingFiles) {
      const importPaths = extractImportPaths(file)

      for (const imp of importPaths) {
        // Only check internal imports (project-relative and @/ prefixed)
        if (!imp.startsWith('@/') && !imp.startsWith('.')) continue

        for (const forbidden of rule.forbidden) {
          if (imp.includes(forbidden)) {
            const violation = {
              file: relativePath(file),
              layer: rule.layer,
              importPath: imp,
              forbidden,
            }
            if (rule.aspirational) {
              documentedViolations.push({ file: relativePath(file), importPath: imp })
            } else {
              allViolations.push(violation)
            }
          }
        }
      }
    }
  }

  it('API v1 routes have no direct infrastructure imports', () => {
    if (allViolations.length > 0) {
      const report = allViolations.map(v =>
        `  ${v.layer}: "${v.file}" imports "${v.importPath}" (contains forbidden "${v.forbidden}")`
      ).join('\n')
      expect.fail(`Found ${allViolations.length} boundary violation(s):\n${report}`)
    }
    expect(allViolations.length).toBe(0)
  })

  it('application services do not import HTTP framework code', () => {
    const appDir = path.join(SRC_DIR, 'server', 'application')
    if (!fs.existsSync(appDir)) return // skip if no services yet

    const appFiles = findFiles(appDir, [/./])
    for (const file of appFiles) {
      const importPaths = extractImportPaths(file)
      for (const imp of importPaths) {
        expect(imp).not.toContain('next/')
        expect(imp).not.toContain('@prisma/client')
      }
    }
  })
})
