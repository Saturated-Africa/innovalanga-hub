import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { tenantScope } from '@/lib/tenant-db'
import { callerInnovatorId } from '@/lib/authz'
import {
  canReview,
  participantMayEdit,
  reviewNeedsNote,
  type ExpenditureStatus,
} from '@/lib/funds/expenditure'

/**
 * PATCH /api/grants/[id]/expenditures/[expenditureId]
 *
 * Review a reported expense, or - for the participant who submitted it - answer
 * a query about one.
 *
 * Accepting an expense is what turns money paid out into money accounted for,
 * which is the figure a funder reads. So the transition is checked against the
 * tested state machine rather than trusted from the request, a note is required
 * where the participant needs to know what to do, and every outcome is written
 * to the audit log.
 */
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept'), note: z.string().trim().max(2000).optional() }),
  z.object({ action: z.literal('query'), note: z.string().trim().min(1).max(2000) }),
  z.object({ action: z.literal('reject'), note: z.string().trim().min(1).max(2000) }),
  /** The participant answering a query, which returns it to the reviewer. */
  z.object({ action: z.literal('resubmit'), note: z.string().trim().max(2000).optional() }),
])

const TARGET: Record<string, ExpenditureStatus> = {
  accept: 'Accepted',
  query: 'Queried',
  reject: 'Rejected',
  resubmit: 'Submitted',
}

const REVIEWERS = ['super_admin', 'facilitator']

export async function PATCH(
  req: Request,
  props: { params: Promise<{ id: string; expenditureId: string }> }
) {
  const params = await props.params
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const body = parsed.data

  const isReviewer = REVIEWERS.includes(session.user.role)
  const ownInnovatorId = await callerInnovatorId(session)

  // Reviewing is staff work; resubmitting is the participant's answer to it.
  // Neither role gets the other's verb.
  if (body.action === 'resubmit' ? isReviewer : !isReviewer) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (body.action === 'resubmit' && !ownInnovatorId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { db: prisma } = scope

  const expenditure = await prisma.grantExpenditure.findFirst({
    where: { id: params.expenditureId, grantId: params.id },
    select: {
      id: true,
      status: true,
      amount: true,
      grant: { select: { id: true, innovatorId: true } },
    },
  })
  if (!expenditure) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (body.action === 'resubmit') {
    if (expenditure.grant.innovatorId !== ownInnovatorId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (!participantMayEdit(expenditure.status as ExpenditureStatus)) {
      return NextResponse.json(
        { error: 'This has already been reviewed, so it can no longer be changed here.' },
        { status: 409 }
      )
    }
  }

  const to = TARGET[body.action]
  const verdict = canReview(expenditure.status as ExpenditureStatus, to)
  if (!verdict.allowed) {
    return NextResponse.json({ error: verdict.reason }, { status: 409 })
  }

  if (reviewNeedsNote(to) && !body.note) {
    return NextResponse.json(
      { error: 'Say why, so the participant knows what to do about it.' },
      { status: 400 }
    )
  }

  const reviewed = body.action !== 'resubmit'
  const updated = await prisma.grantExpenditure.update({
    where: { id: expenditure.id },
    data: {
      status: to,
      reviewNote: body.note ?? null,
      // A resubmission is not a review, so it must not stamp a reviewer onto the
      // row. Clearing them is what puts it back in the queue as unreviewed.
      reviewedBy: reviewed ? (session.user.name ?? session.user.email ?? 'Unknown') : null,
      reviewedAt: reviewed ? new Date() : null,
    },
    select: { id: true, status: true },
  })

  await prisma.auditLog.create({
    data: {
      innovatorId: expenditure.grant.innovatorId,
      actorId: session.user.id,
      action: `grant.expenditure.${body.action}`,
      entityType: 'GrantExpenditure',
      entityId: expenditure.id,
      diff: {
        grantId: expenditure.grant.id,
        amount: expenditure.amount.toString(),
        from: expenditure.status,
        to: updated.status,
      },
    },
  })

  return NextResponse.json({ id: updated.id, status: updated.status })
}
