import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { tenantScope } from '@/lib/tenant-db'
import { systemPrisma } from '@/lib/prisma'
import { fundSummary } from '@/lib/funds/queries'
import { canPayTranche, toCents, type Tranche } from '@/lib/funds/rules'

/**
 * PATCH /api/grants/[id]/tranches/[trancheId]
 *
 * Approve, withhold, release or pay one tranche of a grant.
 *
 * Paying is the guarded action. A funder releases money in stages precisely so
 * that each stage depends on the last being settled, and the check for that
 * lives in lib/funds/rules where it is tested, not here. This route's job is to
 * gather the facts, ask, and refuse with the reasons if the answer is no.
 *
 * Marking a tranche paid is the moment money leaves a funder's account on
 * somebody's say-so, so every outcome is written to the audit log.
 */
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({
    action: z.literal('withhold'),
    reason: z.string().trim().min(1).max(2000),
  }),
  z.object({ action: z.literal('release') }),
  z.object({
    action: z.literal('pay'),
    paidOn: z.string().date(),
    paymentReference: z.string().trim().max(120).optional(),
  }),
  z.object({ action: z.literal('cancel') }),
])

const MAY_APPROVE = ['super_admin', 'facilitator']
/** Paying is narrower than approving. Releasing money is the fund manager's act. */
const MAY_PAY = ['super_admin']

export async function PATCH(
  req: Request,
  props: { params: Promise<{ id: string; trancheId: string }> }
) {
  const params = await props.params;
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!MAY_APPROVE.includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const body = parsed.data

  if (body.action === 'pay' && !MAY_PAY.includes(session.user.role)) {
    return NextResponse.json(
      { error: 'Recording a payment is restricted to the fund manager.' },
      { status: 403 }
    )
  }

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { db: prisma } = scope

  const grant = await prisma.grant.findFirst({
    where: { id: params.id },
    include: { tranches: { orderBy: { sequence: 'asc' } } },
  })
  if (!grant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const tranche = grant.tranches.find((t) => t.id === params.trancheId)
  if (!tranche) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const actor = session.user.name ?? session.user.email ?? 'Unknown'
  let data: Record<string, unknown> = {}

  switch (body.action) {
    case 'approve':
      if (tranche.status !== 'Pending' && tranche.status !== 'Withheld') {
        return NextResponse.json(
          { error: `A tranche that is ${tranche.status.toLowerCase()} cannot be approved.` },
          { status: 409 }
        )
      }
      data = {
        status: 'Approved',
        approvedBy: actor,
        approvedAt: new Date(),
        withheldReason: null,
      }
      break

    case 'withhold':
      if (tranche.status === 'Paid') {
        return NextResponse.json(
          { error: 'This tranche has already been paid.' },
          { status: 409 }
        )
      }
      data = { status: 'Withheld', withheldReason: body.reason }
      break

    case 'release':
      if (tranche.status !== 'Withheld') {
        return NextResponse.json({ error: 'This tranche is not withheld.' }, { status: 409 })
      }
      data = { status: 'Pending', withheldReason: null }
      break

    case 'cancel':
      if (tranche.status === 'Paid') {
        return NextResponse.json(
          { error: 'A paid tranche cannot be cancelled. Record a refund instead.' },
          { status: 409 }
        )
      }
      data = { status: 'Cancelled' }
      break

    case 'pay': {
      // The fund's position is platform-level, so it is read on the owning
      // connection. The grant itself was read through the tenant connection
      // above, which is what confines this whole operation to one programme.
      const fund = await fundSummary(systemPrisma, grant.fundId)
      if (!fund) {
        return NextResponse.json({ error: 'The fund could not be read.' }, { status: 500 })
      }

      const unreviewed = await prisma.grantExpenditure.aggregate({
        where: { grantId: grant.id, status: 'Submitted' },
        _sum: { amount: true },
      })

      const shape = (t: (typeof grant.tranches)[number]): Tranche => ({
        sequence: t.sequence,
        amount: toCents(Number(t.amount)),
        status: t.status as Tranche['status'],
      })

      const verdict = canPayTranche({
        grantStatus: grant.status as never,
        tranche: shape(tranche),
        allTranches: grant.tranches.map(shape),
        fund: fund.balances,
        unreviewedExpenditure: unreviewed._sum.amount
          ? toCents(Number(unreviewed._sum.amount))
          : 0,
      })

      if (!verdict.allowed) {
        return NextResponse.json(
          { error: verdict.reasons.join(' '), reasons: verdict.reasons, warnings: verdict.warnings },
          { status: 409 }
        )
      }

      data = {
        status: 'Paid',
        paidOn: new Date(body.paidOn),
        paymentReference: body.paymentReference ?? null,
      }
      break
    }
  }

  const updated = await prisma.grantTranche.update({
    where: { id: tranche.id },
    data,
  })

  await prisma.auditLog.create({
    data: {
      actorId: session.user.id,
      action: `grant.tranche.${body.action}`,
      entityType: 'GrantTranche',
      entityId: tranche.id,
      diff: {
        grantId: grant.id,
        sequence: tranche.sequence,
        amount: tranche.amount.toString(),
        from: tranche.status,
        to: updated.status,
      },
    },
  })

  return NextResponse.json({ id: updated.id, status: updated.status })
}
