import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { CostCategory } from '@prisma/client'
import { tenantScope } from '@/lib/tenant-db'
import { callerInnovatorId } from '@/lib/authz'
import { canSubmitExpenditure } from '@/lib/funds/expenditure'
import { toCents, type GrantStatus } from '@/lib/funds/rules'

/**
 * POST /api/grants/[id]/expenditures
 *
 * Report what a grant was spent on.
 *
 * A participant may only report against their own grant. The tenant connection
 * confines this to one programme, but row-level security is programme-scoped,
 * not person-scoped, so without the ownership check below a participant could
 * post spending onto a peer's grant. That is the check that matters here.
 *
 * Staff may also submit, because in practice a facilitator captures receipts
 * that arrive on paper or over WhatsApp. Who submitted is recorded either way.
 */
const schema = z.object({
  spentOn: z.string().date(),
  supplier: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2000),
  amount: z.number().finite().positive(),
  category: z.nativeEnum(CostCategory).optional(),
  /** Optionally attributed to the tranche it was funded by. */
  trancheId: z.string().min(1).optional(),
})

const STAFF = ['super_admin', 'facilitator']

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const isStaff = STAFF.includes(session.user.role)
  const ownInnovatorId = await callerInnovatorId(session)
  if (!isStaff && !ownInnovatorId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const input = parsed.data

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { db: prisma } = scope

  const grant = await prisma.grant.findFirst({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      innovatorId: true,
      startDate: true,
      endDate: true,
      tranches: { select: { id: true, amount: true, status: true } },
      expenditures: { select: { amount: true, status: true } },
    },
  })
  if (!grant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // A participant reporting against somebody else's grant is told it does not
  // exist rather than that they may not touch it: the second answer confirms
  // whose grant it is.
  if (!isStaff && grant.innovatorId !== ownInnovatorId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (input.trancheId && !grant.tranches.some((t) => t.id === input.trancheId)) {
    return NextResponse.json(
      { error: 'That tranche does not belong to this grant.' },
      { status: 400 }
    )
  }

  const paid = grant.tranches
    .filter((t) => t.status === 'Paid')
    .reduce((total, t) => total + toCents(Number(t.amount)), 0)
  const alreadyReported = grant.expenditures
    .filter((e) => e.status !== 'Rejected')
    .reduce((total, e) => total + toCents(Number(e.amount)), 0)

  const verdict = canSubmitExpenditure({
    grantStatus: grant.status as GrantStatus,
    paid,
    alreadyReported,
    amount: toCents(input.amount),
    spentOn: input.spentOn,
    today: new Date().toISOString().slice(0, 10),
    grantStartDate: grant.startDate ? grant.startDate.toISOString().slice(0, 10) : null,
    grantEndDate: grant.endDate ? grant.endDate.toISOString().slice(0, 10) : null,
  })

  if (!verdict.allowed) {
    return NextResponse.json(
      { error: verdict.reasons.join(' '), reasons: verdict.reasons },
      { status: 409 }
    )
  }

  const created = await prisma.grantExpenditure.create({
    data: {
      grantId: grant.id,
      trancheId: input.trancheId ?? null,
      spentOn: new Date(input.spentOn),
      supplier: input.supplier,
      description: input.description,
      amount: input.amount,
      category: input.category ?? 'Operational',
      submittedByUserId: session.user.id,
    },
    select: { id: true, status: true },
  })

  await prisma.auditLog.create({
    data: {
      innovatorId: grant.innovatorId,
      actorId: session.user.id,
      action: 'grant.expenditure.submitted',
      entityType: 'GrantExpenditure',
      entityId: created.id,
      diff: {
        grantId: grant.id,
        amount: input.amount,
        supplier: input.supplier,
        onBehalf: isStaff && grant.innovatorId !== ownInnovatorId,
      },
    },
  })

  return NextResponse.json(
    { id: created.id, status: created.status, warnings: verdict.warnings },
    { status: 201 }
  )
}
