import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { resolveProgrammeId } from '@/lib/scope'

/**
 * GET /api/programmes/me
 *
 * The programme the caller is working in. Their own assignment, or the first
 * programme on the platform for a super_admin who has none.
 *
 * That rule used to be written out here as well as in three other places. It is
 * now only in `resolveProgrammeId`, because a copy of it that drifts is a copy
 * that answers a different question from the one the rest of the app asks.
 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const programmeId = await resolveProgrammeId(session)
  return NextResponse.json({ programmeId })
}
