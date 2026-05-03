import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

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

  const { searchParams } = new URL(req.url)
  const programmeId = searchParams.get('programmeId')
  if (!programmeId) return NextResponse.json({ error: 'programmeId required' }, { status: 400 })

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

  const milestone = await prisma.milestoneTracker.create({
    data: {
      ...parsed.data,
      targetDate: new Date(parsed.data.targetDate),
    },
  })
  return NextResponse.json(milestone, { status: 201 })
}
