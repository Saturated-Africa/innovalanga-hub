import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { systemPrisma } from '@/lib/prisma'
import { assertProgrammeInScope } from '@/lib/scope'
import { fundSummary } from '@/lib/funds/queries'
import { canAllocate, toCents } from '@/lib/funds/rules'

/**
 * One fund: recording money received, and earmarking it to programmes.
 *
 * Both run at platform level on the owning connection, because a fund spans
 * programmes and the person doing this is the fund manager. The tenant boundary
 * is drawn at the allocation: once a programme has one, everything that
 * programme does with the money is scoped to it by row-level security.
 */
const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('receipt'),
    amount: z.number().finite(),
    receivedOn: z.string().date(),
    reference: z.string().trim().max(120).optional(),
    note: z.string().trim().max(2000).optional(),
  }),
  z.object({
    action: z.literal('allocate'),
    programmeId: z.string().min(1),
    amount: z.number().finite().nonnegative(),
    note: z.string().trim().max(2000).optional(),
  }),
])

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const body = parsed.data

  const fund = await systemPrisma.fund.findUnique({
    where: { id: params.id },
    select: { id: true, status: true, committedAmount: true },
  })
  if (!fund) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (fund.status === 'Closed') {
    return NextResponse.json({ error: 'This fund is closed.' }, { status: 409 })
  }

  if (body.action === 'receipt') {
    if (body.amount === 0) {
      return NextResponse.json({ error: 'A receipt of nothing is not a receipt.' }, { status: 400 })
    }
    const receipt = await systemPrisma.fundReceipt.create({
      data: {
        fundId: fund.id,
        // A negative receipt records a clawback. Funders do reclaim money, and
        // one running total is easier to trust than two that have to agree.
        amount: body.amount,
        receivedOn: new Date(body.receivedOn),
        reference: body.reference ?? null,
        note: body.note ?? null,
        recordedBy: session.user.name ?? session.user.email ?? 'Unknown',
      },
      select: { id: true },
    })

    await systemPrisma.auditLog.create({
      data: {
        actorId: session.user.id,
        action: 'fund.receipt.recorded',
        entityType: 'Fund',
        entityId: fund.id,
        diff: { amount: body.amount, receivedOn: body.receivedOn, reference: body.reference ?? null },
      },
    })
    return NextResponse.json({ id: receipt.id }, { status: 201 })
  }

  // Allocation. Checked against everything already earmarked elsewhere, with
  // this programme's existing allocation excluded so that editing one is not
  // mistaken for adding a second.
  // Checked against the caller rather than merely confirmed to exist. A fund
  // manager with no programme of their own may allocate to any of them, and
  // that is decided by assertProgrammeInScope rather than assumed here.
  const programmeId = await assertProgrammeInScope(session, body.programmeId)
  if (!programmeId) {
    return NextResponse.json(
      { error: 'That is not a programme you can allocate to.' },
      { status: 403 }
    )
  }

  const programme = await systemPrisma.programme.findUnique({
    where: { id: programmeId },
    select: { id: true, name: true },
  })
  if (!programme) {
    return NextResponse.json({ error: 'That programme does not exist.' }, { status: 404 })
  }

  const others = await systemPrisma.fundAllocation.aggregate({
    where: { fundId: fund.id, programmeId: { not: programmeId } },
    _sum: { amount: true },
  })

  const verdict = canAllocate(
    toCents(Number(fund.committedAmount)),
    others._sum.amount ? toCents(Number(others._sum.amount)) : 0,
    toCents(body.amount)
  )
  if (!verdict.allowed) {
    return NextResponse.json({ error: verdict.reason }, { status: 409 })
  }

  // Reducing an allocation below what the programme has already awarded would
  // leave it overcommitted against money it no longer has.
  const awarded = await systemPrisma.grant.aggregate({
    where: { fundId: fund.id, programmeId: programmeId, status: { not: 'Cancelled' } },
    _sum: { awardedAmount: true },
  })
  const awardedCents = awarded._sum.awardedAmount ? toCents(Number(awarded._sum.awardedAmount)) : 0
  if (toCents(body.amount) < awardedCents) {
    return NextResponse.json(
      {
        error:
          `${programme.name} has already awarded ${(awardedCents / 100).toFixed(2)} from this fund. ` +
          `The allocation cannot be reduced below that.`,
      },
      { status: 409 }
    )
  }

  const allocation = await systemPrisma.fundAllocation.upsert({
    where: { fundId_programmeId: { fundId: fund.id, programmeId: programmeId } },
    create: {
      fundId: fund.id,
      programmeId: programmeId,
      amount: body.amount,
      note: body.note ?? null,
    },
    update: { amount: body.amount, note: body.note ?? null },
    select: { id: true },
  })

  await systemPrisma.auditLog.create({
    data: {
      actorId: session.user.id,
      action: 'fund.allocated',
      entityType: 'Fund',
      entityId: fund.id,
      diff: { programme: programme.name, amount: body.amount },
    },
  })

  return NextResponse.json({ id: allocation.id })
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const summary = await fundSummary(systemPrisma, params.id)
  if (!summary) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(summary)
}
