import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { tenantScope } from '@/lib/tenant-db'
import {
  exportWorkbook,
  ExportCapacityError,
  ExportBlockedError,
} from '@/lib/finance/export-workbook'

/**
 * GET /api/finance/projects/[id]/export?period=Q1
 *
 * Produces the funder's quarterly workbook for one reporting period.
 *
 * The file is generated on demand rather than stored, so it always reflects the
 * current coding and the current evidence. A stored copy would drift the moment
 * somebody corrected a transaction.
 */
export const maxDuration = 60

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'No programme found' }, { status: 404 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  const project = await prisma.financeProject.findFirst({
    where: { id: params.id, programmeId },
    include: { activities: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const periodLabel = new URL(req.url).searchParams.get('period')
  const period = periodLabel
    ? await prisma.reportingPeriod.findFirst({
        where: { projectId: project.id, label: periodLabel },
        include: {
          incomeLines: { orderBy: { sortOrder: 'asc' } },
          varianceNotes: true,
        },
      })
    : await prisma.reportingPeriod.findFirst({
        where: { projectId: project.id },
        orderBy: { startDate: 'asc' },
        include: {
          incomeLines: { orderBy: { sortOrder: 'asc' } },
          varianceNotes: true,
        },
      })

  if (!period) {
    return NextResponse.json(
      { error: 'That reporting period does not exist on this project.' },
      { status: 404 }
    )
  }

  const transactions = await prisma.financeTransaction.findMany({
    where: { projectId: project.id, periodId: period.id },
    // Chronological, as the funder's own sheet is ordered. The activity actuals
    // use the template's formulas, so nothing depends on grouping these.
    orderBy: [{ spentOn: 'asc' }, { createdAt: 'asc' }],
    include: {
      activity: { select: { code: true } },
      proofs: {
        where: { revokedAt: null },
        select: { kind: true, shareToken: true },
      },
    },
  })

  // Written reasons belong to a period and an activity, so they are looked up
  // by activity rather than carried on the activity itself: last quarter's
  // explanation must not reappear against this quarter's figures.
  const noteFor = new Map(
    period.varianceNotes
      .filter((n) => n.activityId !== null)
      .map((n) => [n.activityId as string, n])
  )

  // Evidence links have to be absolute and openable by someone with no account,
  // because they are read from inside a spreadsheet weeks after it is filed.
  const origin = process.env.NEXTAUTH_URL?.replace(/\/$/, '') ?? ''

  try {
    const { buffer, warnings } = await exportWorkbook({
      institutionName: project.institutionName,
      agreementNumber: project.agreementNumber,
      invoiceNumber: period.invoiceNumber,
      periodLabel: period.label,
      reportingPeriod: `${period.startDate.toISOString().slice(0, 10)} to ${period.endDate
        .toISOString()
        .slice(0, 10)}`,
      amountTransferred:
        period.amountTransferred === null ? null : Number(period.amountTransferred),
      bankBalance: period.bankBalance === null ? null : Number(period.bankBalance),
      balanceBroughtForward:
        period.balanceBroughtForward === null ? null : Number(period.balanceBroughtForward),
      fundingBudgeted:
        period.fundingBudgeted === null ? null : Number(period.fundingBudgeted),
      incomeLines: period.incomeLines.map((l) => ({
        label: l.label,
        budget: Number(l.budget),
        actual: Number(l.actual),
      })),
      preparedByName: period.preparedByName,
      preparedOn: period.preparedOn,
      approvedByName: period.approvedByName,
      approvedOn: period.approvedOn,
      activities: project.activities.map((a) => ({
        id: a.id,
        code: a.code,
        milestone: a.milestone,
        workPackage: a.workPackage,
        objective: a.objective,
        details: a.details,
        deliverable: a.deliverable,
        deliverableFormat: a.deliverableFormat,
        startMonth: a.startMonth,
        endMonth: a.endMonth,
        duration: a.duration,
        budgetQ1: Number(a.budgetQ1),
        budgetQ2: Number(a.budgetQ2),
        budgetQ3: Number(a.budgetQ3),
        budgetQ4: Number(a.budgetQ4),
        costCategory: a.costCategory,
        reason: noteFor.get(a.id)?.reason ?? null,
        comment: noteFor.get(a.id)?.comment ?? null,
      })),
      transactions: transactions.map((t) => ({
        spentOn: t.spentOn,
        supplier: t.supplier,
        description: t.description,
        amount: Number(t.amount),
        costCategory: t.costCategory,
        activityId: t.activityId,
        activityCode: t.activity?.code ?? null,
        invoiceUrl: linkFor(origin, t.proofs, 'Invoice'),
        paymentUrl: linkFor(origin, t.proofs, 'ProofOfPayment'),
      })),
    })

    const filename = `${project.institutionName.replace(/[^A-Za-z0-9]+/g, '-')}-${period.label}-financial-report.xlsx`

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        // Warnings travel in a header so the browser download is a plain file
        // rather than a JSON envelope the operator has to unwrap.
        'X-Export-Warnings': String(warnings.length),
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    if (err instanceof ExportBlockedError) {
      return NextResponse.json({ error: err.message, blockers: err.blockers }, { status: 422 })
    }
    if (err instanceof ExportCapacityError) {
      return NextResponse.json(
        { error: err.message, needed: err.needed, capacity: err.capacity },
        { status: 422 }
      )
    }
    throw err
  }
}

function linkFor(
  origin: string,
  proofs: { kind: string; shareToken: string }[],
  kind: string
): string | null {
  const found = proofs.find((p) => p.kind === kind)
  return found ? `${origin}/proof/${found.shareToken}` : null
}
