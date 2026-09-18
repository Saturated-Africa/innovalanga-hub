import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { FundStatus, ManagementFeeBasis } from '@prisma/client'
import { systemPrisma } from '@/lib/prisma'

/**
 * Funds, administered at platform level.
 *
 * A fund sits above programmes: one can back several, and a programme can be
 * co-funded. So this runs on the owning connection, the way user administration
 * does, and is restricted to the fund manager. Allocating a fund to a programme
 * is a separate act with its own route, and that is where the tenant boundary
 * is drawn.
 *
 * The fee rate is a rate, not a percentage. 0.075 is seven and a half percent.
 * Anything above 1 is refused here, by a database constraint, and again in
 * lib/funds/rules, because somebody typing 7.5 and meaning percent would
 * otherwise invoice a funder for seven and a half times their own fund.
 */
const schema = z.object({
  funderName: z.string().trim().min(1).max(200),
  funderShortName: z.string().trim().max(60).optional(),
  name: z.string().trim().min(1).max(200),
  reference: z.string().trim().max(60).optional(),
  committedAmount: z.number().finite().nonnegative(),
  currency: z.string().trim().length(3).default('ZAR'),
  startDate: z.string().date(),
  endDate: z.string().date(),
  status: z.nativeEnum(FundStatus).default('Draft'),
  managementFeeRate: z.number().finite().min(0).max(1).nullable().optional(),
  managementFeeBasis: z.nativeEnum(ManagementFeeBasis).nullable().optional(),
  notes: z.string().trim().max(4000).optional(),
})

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { fundSummaries } = await import('@/lib/funds/queries')
  const funds = await fundSummaries(systemPrisma)
  return NextResponse.json(funds)
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const input = parsed.data

  if (new Date(input.endDate) < new Date(input.startDate)) {
    return NextResponse.json({ error: 'The fund ends before it starts.' }, { status: 400 })
  }
  // A fee basis without a rate, or a rate without a basis, is half a decision.
  const hasRate = input.managementFeeRate !== null && input.managementFeeRate !== undefined
  const hasBasis = input.managementFeeBasis !== null && input.managementFeeBasis !== undefined
  if (hasRate !== hasBasis) {
    return NextResponse.json(
      { error: 'A management fee needs both a rate and a basis, or neither.' },
      { status: 400 }
    )
  }

  // The funder is found or created by name. Funders are few and long-lived, and
  // making the operator create one first would be a step with no decision in it.
  const funder = await systemPrisma.funder.upsert({
    where: { name: input.funderName },
    create: { name: input.funderName, shortName: input.funderShortName ?? null },
    update: input.funderShortName ? { shortName: input.funderShortName } : {},
    select: { id: true },
  })

  const fund = await systemPrisma.fund.create({
    data: {
      funderId: funder.id,
      name: input.name,
      reference: input.reference ?? null,
      committedAmount: input.committedAmount,
      currency: input.currency.toUpperCase(),
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
      status: input.status,
      managementFeeRate: input.managementFeeRate ?? null,
      managementFeeBasis: input.managementFeeBasis ?? null,
      notes: input.notes ?? null,
    },
    select: { id: true },
  })

  await systemPrisma.auditLog.create({
    data: {
      actorId: session.user.id,
      action: 'fund.created',
      entityType: 'Fund',
      entityId: fund.id,
      diff: {
        funder: input.funderName,
        name: input.name,
        committedAmount: input.committedAmount,
        currency: input.currency,
      },
    },
  })

  return NextResponse.json({ id: fund.id }, { status: 201 })
}
