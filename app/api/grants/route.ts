import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { EntityType } from '@prisma/client'
import { tenantScope } from '@/lib/tenant-db'
import { innovatorInProgramme } from '@/lib/authz'
import { canAward, toCents, tranchesReconcile } from '@/lib/funds/rules'
import { checkRegistration, type EntityKind } from '@/lib/company-registration'

/**
 * POST /api/grants
 *
 * Award a grant to a participant, with its payment schedule.
 *
 * The schedule is created with the grant rather than afterwards, because a
 * grant with no tranches is an award nobody can pay, and one whose tranches do
 * not add up to the award is a disagreement that only surfaces at the last
 * payment. Both are refused here.
 *
 * The award is checked against what this programme has been allocated, not
 * against what the fund holds. A programme that has spent its share cannot
 * reach into another programme's money because the fund happens to have some
 * left.
 */
const schema = z.object({
  fundId: z.string().min(1),
  innovatorId: z.string().min(1),
  entityName: z.string().trim().min(1).max(200),
  entityType: z.nativeEnum(EntityType),
  entityRegistrationNumber: z.string().trim().max(60).optional(),
  reference: z.string().trim().max(60).optional(),
  purpose: z.string().trim().min(1).max(4000),
  awardedAmount: z.number().finite().positive(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  tranches: z
    .array(
      z.object({
        amount: z.number().finite().positive(),
        plannedDate: z.string().date().optional(),
        conditions: z.string().trim().max(2000).optional(),
      })
    )
    .min(1)
    .max(24),
})

const MAY_AWARD = ['super_admin', 'facilitator']

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!MAY_AWARD.includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const input = parsed.data

  /*
   * The registration number is checked here too, by the same rule as onboarding.
   *
   * A grant agreement carries this number, and a funder uses it to look the entity
   * up. It was previously free text: a digit could be dropped at award time and
   * nothing would notice until somebody tried to find the company.
   */
  let registrationNumber: string | null = null
  if (input.entityRegistrationNumber && input.entityRegistrationNumber.trim() !== '') {
    const verdict = checkRegistration(
      input.entityRegistrationNumber,
      input.entityType as EntityKind
    )
    if (!verdict.ok) {
      return NextResponse.json({ error: verdict.error }, { status: 400 })
    }
    registrationNumber = verdict.normalised ?? null
  }

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'No programme found' }, { status: 404 })
  const { programmeId, db: prisma } = scope

  if (!(await innovatorInProgramme(input.innovatorId, programmeId))) {
    return NextResponse.json(
      { error: 'That participant is not in your programme.' },
      { status: 403 }
    )
  }

  // The allocation row carries the programme, so the tenant connection can only
  // see this programme's share of the fund. A fund with no allocation here is
  // simply not visible, which is the right answer to "can we award from it".
  const allocation = await prisma.fundAllocation.findFirst({
    where: { fundId: input.fundId, programmeId },
  })
  if (!allocation) {
    return NextResponse.json(
      { error: 'That fund has no allocation to this programme.' },
      { status: 403 }
    )
  }

  const awardedSoFar = await prisma.grant.aggregate({
    where: { fundId: input.fundId, programmeId, status: { not: 'Cancelled' } },
    _sum: { awardedAmount: true },
  })

  const award = toCents(input.awardedAmount)
  const verdict = canAward(
    toCents(Number(allocation.amount)),
    awardedSoFar._sum.awardedAmount ? toCents(Number(awardedSoFar._sum.awardedAmount)) : 0,
    award
  )
  if (!verdict.allowed) {
    return NextResponse.json({ error: verdict.reason }, { status: 409 })
  }

  const reconciliation = tranchesReconcile(
    award,
    input.tranches.map((t) => ({ amount: toCents(t.amount), status: 'Pending' as const }))
  )
  if (!reconciliation.balanced) {
    const over = reconciliation.difference > 0
    return NextResponse.json(
      {
        error:
          `The tranches add up to ${(reconciliation.scheduled / 100).toFixed(2)}, ` +
          `which is ${Math.abs(reconciliation.difference / 100).toFixed(2)} ` +
          `${over ? 'more' : 'less'} than the award.`,
      },
      { status: 400 }
    )
  }

  const grant = await prisma.grant.create({
    data: {
      programmeId,
      fundId: input.fundId,
      innovatorId: input.innovatorId,
      entityName: input.entityName,
      entityType: input.entityType,
      entityRegistrationNumber: registrationNumber,
      reference: input.reference ?? null,
      purpose: input.purpose,
      awardedAmount: input.awardedAmount,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
      tranches: {
        create: input.tranches.map((t, index) => ({
          sequence: index + 1,
          amount: t.amount,
          plannedDate: t.plannedDate ? new Date(t.plannedDate) : null,
          conditions: t.conditions ?? null,
        })),
      },
    },
    select: { id: true },
  })

  await prisma.auditLog.create({
    data: {
      innovatorId: input.innovatorId,
      actorId: session.user.id,
      action: 'grant.awarded',
      entityType: 'Grant',
      entityId: grant.id,
      diff: {
        fundId: input.fundId,
        entityName: input.entityName,
        awardedAmount: input.awardedAmount,
        tranches: input.tranches.length,
      },
    },
  })

  return NextResponse.json({ id: grant.id }, { status: 201 })
}
