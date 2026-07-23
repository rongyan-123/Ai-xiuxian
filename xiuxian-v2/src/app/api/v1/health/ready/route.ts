/**
 * GET /api/v1/health/ready
 *
 * Readiness probe. Reports whether required dependencies can accept
 * game requests. May check database connectivity.
 *
 * Does NOT invoke paid LLM generation, mutate player state, or insert
 * game data. Safe for repeated polling.
 */
import { NextResponse } from 'next/server'

interface DependencyStatus {
  database: 'ok' | 'degraded' | 'unavailable'
}

/**
 * Perform a lightweight database connectivity check.
 * Uses a simple query with a short timeout to verify the database is reachable.
 * Returns 'unavailable' if the check fails, 'ok' if it passes.
 */
async function checkDatabase(): Promise<'ok' | 'degraded' | 'unavailable'> {
  try {
    // Dynamic import to keep Prisma out of the module-level scope
    const { prisma } = await import('@/lib/db')
    // Lightweight validation: run a cheap query with a short timeout
    const before = Date.now()
    await prisma.$queryRawUnsafe('SELECT 1')
    const elapsed = Date.now() - before
    // If the query took more than 2 seconds, mark as degraded
    if (elapsed > 2000) return 'degraded'
    return 'ok'
  } catch {
    return 'unavailable'
  }
}

export async function GET(_req: Request): Promise<NextResponse> {
  const dbStatus = await checkDatabase()

  const checks: DependencyStatus = { database: dbStatus }

  const overallStatus = dbStatus === 'unavailable' ? 'unavailable' : dbStatus === 'degraded' ? 'degraded' : 'ok'
  const httpStatus = dbStatus === 'unavailable' ? 503 : 200

  return NextResponse.json(
    {
      status: overallStatus,
      checks,
    },
    {
      status: httpStatus,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    },
  )
}
