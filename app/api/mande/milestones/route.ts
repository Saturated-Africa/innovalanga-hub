import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { resolveProgrammeId, assertProgrammeInScope } from '@/lib/scope'

const MilestoneSchema = z.object({
  programmeId: z.string().min(1),
  cohortId: z.string().optional().nullable(),
  innovatorId: z.string().optional().nullable(),
  title: z.string().min(1),
  description: z.string().optional(),
  targetDate: z.string(),
  status: z.enum(['NotStarted', 'InProgress', 'Completed', 'Delayed', 'AtRisk']).optional(),
  notes: z.string().optional(),
})

export async function GET(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator', 'funder_viewer'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Programme comes from the session, never from the query string. Trusting
  // the parameter here let any authenticated facilitator or funder read another
  // programme's data by editing the URL.
  const programmeId = await resolveProgrammeId(session)
  if (!programmeId) return NextResponse.json({ error: 'No programme found' }, { status: 404 })

  const milestones = await prisma.milestoneTracker.findMany({
    where: { programmeId },
    include: {
      cohort: { select: { name: true } },
      innovator: { select: { firstName: true, lastName: true } },
    },
    orderBy: { targetDate: 'asc' },
  })
  return NextResponse.json(milestones)
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = MilestoneSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // The client supplies programmeId in the body; validate it against the
  // session rather than trusting it, otherwise this is a cross-programme write.
  const programmeId = await assertProgrammeInScope(session, parsed.data.programmeId)
  if (!programmeId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const milestone = await prisma.milestoneTracker.create({
    data: {
      ...parsed.data,
      programmeId,
      targetDate: new Date(parsed.data.targetDate),
    },
  })
  return NextResponse.json(milestone, { status: 201 })
}
