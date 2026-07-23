/**
 * Test database setup utilities.
 *
 * Ensures tests use a disposable test database, never the production/development DB.
 * Usage:
 *   vitest --config vitest.db.config.mts
 *
 * Prerequisites:
 *   Createdb: CREATE DATABASE xiuxian_test;
 *   Migrate:  npx prisma migrate deploy (with DATABASE_URL pointing to test DB)
 */

import { execSync } from 'child_process'

/** Exact allow-list of disposable database names permitted for destructive tests. */
const DESTRUCTIVE_TEST_DB_NAMES = new Set([
  'xiuxian_test',
  'xiuxian_destructive_test',
])

/** Name patterns that are NOT sufficient on their own (too permissive). */
const BLOCKED_DB_PATTERNS = [/xiuxian_prod/i, /xiuxian_dev/i, /xiuxian_live/i]

/**
 * Verifies the DATABASE_URL environment variable does NOT point to the
 * production/development database. Must be called before any test suite runs.
 *
 * The database name must match the exact allow-list. A URL merely containing
 * the substring "test" is insufficient.
 */
export function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL || ''

  const dbName = extractDbName(url)

  if (!DESTRUCTIVE_TEST_DB_NAMES.has(dbName)) {
    throw new Error(
      `DATABASE_URL must point to a known test database (${[...DESTRUCTIVE_TEST_DB_NAMES].join(', ')}), got: ${redactUrl(url)}`
    )
  }

  for (const pattern of BLOCKED_DB_PATTERNS) {
    if (pattern.test(dbName)) {
      throw new Error(
        `DATABASE_URL looks like a production/development database: ${redactUrl(url)}`
      )
    }
  }
}

/** Extracts database name from a PostgreSQL connection URL. */
function extractDbName(url: string): string {
  // postgresql://user:pass@host:port/dbname?params
  const match = url.match(/\/([^/?]+)(\?|$)/)
  return match ? match[1] : ''
}

/** Redacts credentials from a database URL for error messages. */
function redactUrl(url: string): string {
  return url.replace(/\/\/[^@]+@/, '//***@')
}

/**
 * Runs Prisma migrations against the test database.
 * Idempotent — safe to call before every test run.
 */
export function migrateTestDb(): void {
  assertTestDatabase()
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env },
  })
}

/**
 * Clears all data from the test database tables between tests.
 * Uses TRUNCATE for speed; resets sequences.
 */
export async function clearTestDb(): Promise<void> {
  assertTestDatabase()
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()
  try {
    await prisma.$executeRawUnsafe(`
      DO $$ DECLARE r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations')
        LOOP
          EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `)
  } finally {
    await prisma.$disconnect()
  }
}
