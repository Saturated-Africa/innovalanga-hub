import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertProgrammeInScope } from '@/lib/scope'

interface Params { params: { id: string } }

/**
 * The regions one programme operates in.
 *
 * Same shape, and same gap, as the periods route beside it: the programme came
 * from the path and was never checked against the caller.
 */
export async function GET(_req: Request, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const programmeId = await assertProgrammeInScope(session, params.id)
  if (!programmeId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const regions = await prisma.region.findMany({
    where: { programmeId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, code: true },
  })
  return NextResponse.json(regions)
}
