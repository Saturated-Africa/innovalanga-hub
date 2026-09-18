import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * Health endpoint.
 *
 * The app previously had none, and every other route is either session-gated or
 * secret-gated, so nothing could serve as a container healthcheck.
 *
 * `GET /api/health`        liveness  - the process is up and serving
 * `GET /api/health?deep=1` readiness - the database is reachable too
 *
 * The deep variant is deliberately opt-in: a database blip should not cause the
 * container runtime to kill an otherwise healthy process, but a load balancer
 * or a deploy gate does want to know.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const deep = new URL(req.url).searchParams.has('deep')

  if (!deep) {
    return NextResponse.json({ status: 'ok', checked: 'liveness' })
  }

  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ status: 'ok', checked: 'readiness', database: 'up' })
  } catch (err) {
    console.error('[health] database unreachable:', err)
    return NextResponse.json(
      { status: 'degraded', checked: 'readiness', database: 'down' },
      { status: 503 }
    )
  }
}
