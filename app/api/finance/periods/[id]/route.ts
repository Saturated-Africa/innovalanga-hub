import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { ReportingPeriodStatus } from '@prisma/client'
import { tenantScope } from '@/lib/tenant-db'

/**
 * PATCH /api/finance/periods/[id]
 *
 * The reconciliation figures and the declaration for one reporting period.
 *
 * These are the numbers the funder's workbook asks for that no bank line
 * supplies: what was transferred, what was carried over, what the bank says at
 * the end, and who is putting their name to the report. Until they live here
 * the export leaves the template's own values in place, which means the
 * previous submitter's figures and signature go out under this agreement.
 */
const money = z.number().finite().min(-1_000_000_000).max(1_000_000_000).nullable()

const schema = z.object({
  amountTransferred: money.optional(),
  bankBalance: money.optional(),
  balanceBroughtForward: money.optional(),
  fundingBudgeted: money.optional(),
  invoiceNumber: z.string().trim().max(60).nullable().optional(),
  preparedByName: z.string().trim().max(120).nullable().optional(),
  preparedOn: z.string().date().nullable().optional(),
  approvedByName: z.string().trim().max(120).nullable().optional(),
  approvedOn: z.string().date().nullable().optional(),
  status: z.nativeEnum(ReportingPeriodStatus).optional(),
  /**
   * Replaces the whole set rather than merging. The funder gives four free
   * income rows and they are edited as one small table, so a partial update
   * would leave a deleted line behind with no way to remove it.
   */
  incomeLines: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(120),
        budget: z.number().finite(),
        actual: z.number().finite(),
      })
    )
    .max(4)
    .optional(),
})

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
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

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'No programme found' }, { status: 404 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  const period = await prisma.reportingPeriod.findFirst({
    where: { id: params.id, project: { programmeId } },
    select: { id: true, status: true },
  })
  if (!period) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (period.status === 'Accepted') {
    return NextResponse.json(
      { error: 'This period has been accepted by the funder and can no longer be edited.' },
      { status: 409 }
    )
  }

  const { incomeLines, ...fields } = parsed.data
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    data[key] =
      (key === 'preparedOn' || key === 'approvedOn') && typeof value === 'string'
        ? new Date(value)
        : value
  }
  if (fields.status === 'Submitted') data.submittedAt = new Date()

  // One transaction, so a failure part-way through cannot leave the income
  // lines deleted and their replacements unwritten.
  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.reportingPeriod.update({ where: { id: period.id }, data })
    }
    if (incomeLines) {
      await tx.periodIncome.deleteMany({ where: { periodId: period.id } })
      if (incomeLines.length > 0) {
        await tx.periodIncome.createMany({
          data: incomeLines.map((line, index) => ({
            periodId: period.id,
            label: line.label,
            budget: line.budget,
            actual: line.actual,
            sortOrder: index,
          })),
        })
      }
    }
  })

  await prisma.auditLog.create({
    data: {
      actorId: session.user.id,
      action: 'finance.period.updated',
      entityType: 'ReportingPeriod',
      entityId: period.id,
      diff: { ...data, incomeLines: incomeLines?.length ?? null },
    },
  })

  return NextResponse.json({ ok: true })
}
