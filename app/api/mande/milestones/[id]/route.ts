import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { MilestoneStatus } from '@prisma/client'
import { tenantScope } from '@/lib/tenant-db'
import { innovatorInProgramme } from '@/lib/authz'

/**
 * Same two problems as the indicators route: no programme scope on either
 * handler, and a raw request body spread into `data`, which allowed a
 * cross-tenant `programmeId` reassignment and Prisma nested writes.
 *
 * `programmeId` is absent from this schema on purpose. Dates arrive as strings
 * and are coerced here rather than trusted as whatever the client sent.
 */
const schema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  targetDate: z.coerce.date().optional(),
  completedDate: z.coerce.date().nullable().optional(),
  status: z.nativeEnum(MilestoneStatus).optional(),
  notes: z.string().max(2000).nullable().optional(),
  cohortId: z.string().nullable().optional(),
  innovatorId: z.string().nullable().optional(),
})

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'No programme found' }, { status: 404 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })
  }

  // Both foreign keys are client-supplied, so both are checked against the
  // caller's programme rather than trusted.
  if (parsed.data.cohortId) {
    const cohort = await prisma.cohort.findFirst({
      where: { id: parsed.data.cohortId, programmeId },
      select: { id: true },
    })
    if (!cohort) {
      return NextResponse.json({ error: 'Cohort not found in your programme' }, { status: 403 })
    }
  }
  if (parsed.data.innovatorId) {
    if (!(await innovatorInProgramme(parsed.data.innovatorId, programmeId))) {
      return NextResponse.json({ error: 'Innovator not found in your programme' }, { status: 403 })
    }
  }

  const result = await prisma.milestoneTracker.updateMany({
    where: { id: params.id, programmeId },
    data: parsed.data,
  })
  if (result.count === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const milestone = await prisma.milestoneTracker.findUnique({ where: { id: params.id } })
  return NextResponse.json(milestone)
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'No programme found' }, { status: 404 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope

  const deleted = await prisma.milestoneTracker.deleteMany({
    where: { id: params.id, programmeId },
  })
  if (deleted.count === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
