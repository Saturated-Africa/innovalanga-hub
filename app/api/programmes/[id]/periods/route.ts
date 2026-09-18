import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertProgrammeInScope } from '@/lib/scope'

interface Params { params: Promise<{ id: string }> }

/**
 * The assessment periods one programme measures against.
 *
 * The programme comes from the path, which is fine as long as it is checked
 * against the caller. It was not: any signed-in account could read any
 * programme's period definitions by changing the id. That is configuration
 * rather than personal data, but it names another funder's measurement schedule
 * to somebody with no relationship to it.
 */
export async function GET(_req: Request, props: Params) {
  const params = await props.params;
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const programmeId = await assertProgrammeInScope(session, params.id)
  if (!programmeId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const periods = await prisma.assessmentPeriodDef.findMany({
    where: { programmeId },
    orderBy: { order: 'asc' },
  })
  return NextResponse.json(periods)
}
