/**
 * GET /api/v1/health/live
 *
 * Liveness probe. Proves the process can respond.
 * Does NOT check any dependencies, invoke paid models, or mutate state.
 * Safe for high-frequency polling by infrastructure.
 */
import { NextResponse } from 'next/server'

export async function GET(_req: Request): Promise<NextResponse> {
  return NextResponse.json(
    { status: 'ok' },
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    },
  )
}
