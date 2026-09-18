import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { CostCategory } from '@prisma/client'
import { tenantScope } from '@/lib/tenant-db'

/**
 * PATCH /api/finance/transactions
 *
 * Code one or many transactions to an activity, and optionally recategorise
 * them.
 *
 * Bulk by design. A quarter carries well over a hundred bank lines and most of
 * them belong to a handful of activities, so coding them one at a time is the
 * manual work this module exists to remove. The same endpoint handles a single
 * row, which keeps one set of authorisation checks rather than two.
 */
const schema = z.object({
  transactionIds: z.array(z.string().min(1)).min(1).max(500),
  /** Null clears the coding, which is how a mistake is undone. */
  activityId: z.string().min(1).nullable().optional(),
  costCategory: z.nativeEnum(CostCategory).optional(),
})

export async function PATCH(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })
  }

  const { transactionIds, activityId, costCategory } = parsed.data
  if (activityId === undefined && costCategory === undefined) {
    return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })
  }

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'No programme found' }, { status: 404 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  // Every transaction must sit in one project inside the caller's programme.
  // Loading them first means a request naming rows from two projects, or from
  // somebody else's, is refused rather than partially applied.
  const rows = await prisma.financeTransaction.findMany({
    where: { id: { in: transactionIds }, project: { programmeId } },
    select: { id: true, projectId: true },
  })

  if (rows.length !== transactionIds.length) {
    return NextResponse.json(
      { error: 'Some of those transactions are not in your programme.' },
      { status: 403 }
    )
  }

  const projectIds = new Set(rows.map((r) => r.projectId))
  if (projectIds.size !== 1) {
    return NextResponse.json(
      { error: 'Transactions from more than one project cannot be coded together.' },
      { status: 400 }
    )
  }
  const projectId = rows[0].projectId

  // An activity from a different project would silently break the export's
  // sums, so it is checked against the same project rather than trusted.
  if (activityId) {
    const activity = await prisma.projectActivity.findFirst({
      where: { id: activityId, projectId },
      select: { id: true },
    })
    if (!activity) {
      return NextResponse.json(
        { error: 'That activity does not belong to this project.' },
        { status: 403 }
      )
    }
  }

  const data: { activityId?: string | null; costCategory?: CostCategory } = {}
  if (activityId !== undefined) data.activityId = activityId
  if (costCategory !== undefined) data.costCategory = costCategory

  const result = await prisma.financeTransaction.updateMany({
    where: { id: { in: transactionIds }, projectId },
    data,
  })

  await prisma.auditLog.create({
    data: {
      actorId: session.user.id,
      action: 'finance.transactions.coded',
      entityType: 'FinanceProject',
      entityId: projectId,
      diff: { count: result.count, activityId: activityId ?? null, costCategory: costCategory ?? null },
    },
  })

  return NextResponse.json({ updated: result.count })
}
