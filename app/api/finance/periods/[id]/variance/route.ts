import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { tenantScope } from '@/lib/tenant-db'

/**
 * PUT /api/finance/periods/[id]/variance
 *
 * The written reason an activity's spend differs from its budget.
 *
 * Held against the period as well as the activity, because an explanation is
 * true of one quarter and not of the next. Carrying it on the activity would
 * mean last quarter's reason reappearing beside this quarter's figures, which
 * is both wrong and the kind of wrong nobody notices.
 *
 * An empty reason deletes the note rather than storing a blank, so the export's
 * missing-reason check has one thing to look at.
 */
const schema = z.object({
  activityId: z.string().min(1),
  reason: z.string().trim().max(2000),
  comment: z.string().trim().max(2000).optional(),
})

export async function PUT(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.issues },
      { status: 400 }
    )
  }
  const { activityId, reason, comment } = parsed.data

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'No programme found' }, { status: 404 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  const period = await prisma.reportingPeriod.findFirst({
    where: { id: params.id, project: { programmeId } },
    select: { id: true, projectId: true, status: true },
  })
  if (!period) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (period.status === 'Accepted') {
    return NextResponse.json(
      { error: 'This period has been accepted by the funder and can no longer be edited.' },
      { status: 409 }
    )
  }

  // The activity has to belong to the same project, or a note would attach to
  // an activity that never appears on this report.
  const activity = await prisma.projectActivity.findFirst({
    where: { id: activityId, projectId: period.projectId },
    select: { id: true },
  })
  if (!activity) {
    return NextResponse.json(
      { error: 'That activity does not belong to this project.' },
      { status: 403 }
    )
  }

  if (reason.length === 0) {
    await prisma.periodVarianceNote.deleteMany({
      where: { periodId: period.id, activityId: activity.id },
    })
    return NextResponse.json({ ok: true, cleared: true })
  }

  await prisma.periodVarianceNote.upsert({
    where: { periodId_activityId: { periodId: period.id, activityId: activity.id } },
    create: {
      periodId: period.id,
      activityId: activity.id,
      reason,
      comment: comment || null,
    },
    update: { reason, comment: comment || null },
  })

  return NextResponse.json({ ok: true })
}
