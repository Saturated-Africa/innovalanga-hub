import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { tenantScope } from '@/lib/tenant-db'
import { quarterOf } from '@/lib/finance/quarterly'

/**
 * POST /api/finance/periods
 *
 * Open a reporting period on a project.
 *
 * The label is constrained to a quarter because the funder's sheet reports one
 * quarter of a four-column budget at a time, and works out which column from
 * this label. A period called "January" would export a budget belonging to some
 * other three months, and the figures would look entirely reasonable.
 */
const schema = z.object({
  projectId: z.string().min(1),
  label: z.string().trim().min(1).max(40),
  startDate: z.string().date(),
  endDate: z.string().date(),
})

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })
  }
  const { projectId, label, startDate, endDate } = parsed.data

  if (quarterOf(label) === null) {
    return NextResponse.json(
      { error: 'The label has to name a quarter, such as "Q1" or "Q3 2026".' },
      { status: 400 }
    )
  }
  if (new Date(endDate) < new Date(startDate)) {
    return NextResponse.json({ error: 'The period ends before it starts.' }, { status: 400 })
  }

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'No programme found' }, { status: 404 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  const project = await prisma.financeProject.findFirst({
    where: { id: projectId, programmeId },
    select: { id: true },
  })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const clash = await prisma.reportingPeriod.findFirst({
    where: { projectId: project.id, label },
    select: { id: true },
  })
  if (clash) {
    return NextResponse.json(
      { error: `This project already has a period called ${label}.` },
      { status: 409 }
    )
  }

  const period = await prisma.reportingPeriod.create({
    data: {
      projectId: project.id,
      label,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
    },
  })

  await prisma.auditLog.create({
    data: {
      actorId: session.user.id,
      action: 'finance.period.opened',
      entityType: 'ReportingPeriod',
      entityId: period.id,
      diff: { label, startDate, endDate },
    },
  })

  return NextResponse.json({ id: period.id }, { status: 201 })
}
