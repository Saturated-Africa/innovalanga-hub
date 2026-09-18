import { getSession } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/PageHeader'
import { formatDate } from '@/lib/utils'
import { tenantScope } from '@/lib/tenant-db'
import { ArrowLeft, Download, AlertTriangle, CircleAlert } from 'lucide-react'
import { quarterOf } from '@/lib/finance/quarterly'
import { assessReadiness } from '@/lib/finance/readiness'
import { PeriodReconciliation } from '@/components/finance/PeriodReconciliation'
import { VarianceTable } from '@/components/finance/VarianceTable'

/**
 * One reporting period, and everything the funder's workbook needs from it.
 *
 * The page exists because the export used to draw its figures from whatever the
 * template last held. Budget and actual now come from the project plan and the
 * coded transactions; the reconciliation figures, the written reasons and the
 * declaration come from here. Nothing on the exported sheet is left to the
 * template's memory of a previous submission.
 */

const money = (n: number) =>
  n.toLocaleString('en-ZA', { style: 'currency', currency: 'ZAR' })

/** A decimal that may be absent, rendered for a text input. */
const field = (value: { toString(): string } | null) => (value === null ? '' : String(value))

const dateField = (value: Date | null) =>
  value === null ? '' : value.toISOString().slice(0, 10)

export default async function PeriodPage({
  params,
}: {
  params: { id: string; periodId: string }
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.user.role !== 'super_admin') redirect('/dashboard')

  const scope = await tenantScope(session)
  if (!scope) redirect('/dashboard')
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  const period = await prisma.reportingPeriod.findFirst({
    where: { id: params.periodId, projectId: params.id, project: { programmeId } },
    include: {
      project: { include: { activities: { orderBy: { sortOrder: 'asc' } } } },
      incomeLines: { orderBy: { sortOrder: 'asc' } },
      varianceNotes: true,
    },
  })
  if (!period) notFound()

  const project = period.project

  const transactions = await prisma.financeTransaction.findMany({
    where: { projectId: project.id, periodId: period.id },
    select: {
      id: true,
      amount: true,
      activityId: true,
      proofs: { where: { revokedAt: null }, select: { id: true } },
    },
  })

  // Actual spend per activity, summed from the transactions coded to it. This
  // is the same set the exporter reaches for, so the figure on this screen and
  // the figure the funder receives cannot disagree.
  const actualByActivity = new Map<string, number>()
  for (const t of transactions) {
    if (!t.activityId) continue
    actualByActivity.set(
      t.activityId,
      (actualByActivity.get(t.activityId) ?? 0) + Number(t.amount)
    )
  }

  const noteFor = new Map(
    period.varianceNotes
      .filter((n) => n.activityId !== null)
      .map((n) => [n.activityId as string, n])
  )

  const quarter = quarterOf(period.label)
  const budgetFor = (a: (typeof project.activities)[number]) => {
    if (quarter === 1) return Number(a.budgetQ1)
    if (quarter === 2) return Number(a.budgetQ2)
    if (quarter === 3) return Number(a.budgetQ3)
    if (quarter === 4) return Number(a.budgetQ4)
    return 0
  }

  const rows = project.activities.map((a) => ({
    activityId: a.id,
    code: a.code,
    details: a.details,
    costCategory: a.costCategory,
    budget: budgetFor(a),
    actual: actualByActivity.get(a.id) ?? 0,
    reason: noteFor.get(a.id)?.reason ?? '',
    comment: noteFor.get(a.id)?.comment ?? '',
  }))

  const uncoded = transactions.filter((t) => !t.activityId).length
  const withoutProof = transactions.filter((t) => t.proofs.length === 0).length

  const readiness = assessReadiness({
    periodLabel: period.label,
    amountTransferred:
      period.amountTransferred === null ? null : Number(period.amountTransferred),
    fundingBudgeted:
      period.fundingBudgeted === null ? null : Number(period.fundingBudgeted),
    balanceBroughtForward:
      period.balanceBroughtForward === null ? null : Number(period.balanceBroughtForward),
    bankBalance: period.bankBalance === null ? null : Number(period.bankBalance),
    invoiceNumber: period.invoiceNumber,
    preparedByName: period.preparedByName,
    approvedByName: period.approvedByName,
    activities: rows.map((r) => ({
      code: r.code,
      budget: r.budget,
      actual: r.actual,
      hasReason: r.reason.trim() !== '',
    })),
    transactionCount: transactions.length,
    uncodedCount: uncoded,
    withoutProofCount: withoutProof,
  })

  const totalBudget = rows.reduce((sum, r) => sum + r.budget, 0)
  const totalActual = transactions.reduce((sum, t) => sum + Number(t.amount), 0)
  const locked = period.status === 'Accepted'

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${project.institutionName} · ${period.label}`}
        description={`${formatDate(period.startDate)} to ${formatDate(period.endDate)}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={period.status === 'Open' ? 'secondary' : 'default'}>
              {period.status}
            </Badge>
            <Button variant="ghost" asChild>
              <Link href={`/dashboard/finance/${project.id}`}>
                <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden />
                Project
              </Link>
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Budget this quarter" value={money(totalBudget)} />
        <Stat label="Spend this quarter" value={money(totalActual)} />
        <Stat label="Transactions" value={String(transactions.length)} />
        <Stat
          label="Unexplained or uncoded"
          value={String(readiness.gaps.length)}
          tone={readiness.gaps.length ? 'warn' : undefined}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Export</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {readiness.blockers.length > 0 && (
            <ul className="space-y-2">
              {readiness.blockers.map((b) => (
                <li
                  key={b}
                  className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}

          {readiness.gaps.length > 0 && (
            <ul className="space-y-2">
              {readiness.gaps.map((g) => (
                <li key={g} className="flex gap-2 text-sm text-muted-foreground">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                  <span>{g}</span>
                </li>
              ))}
            </ul>
          )}

          {readiness.blockers.length === 0 && readiness.gaps.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Everything the funder asks for is recorded.
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button asChild={readiness.ready} disabled={!readiness.ready} variant="outline">
              {readiness.ready ? (
                <a
                  href={`/api/finance/projects/${project.id}/export?period=${encodeURIComponent(period.label)}`}
                  download
                >
                  <Download className="mr-1.5 h-4 w-4" aria-hidden />
                  Export workbook
                </a>
              ) : (
                <span>
                  <Download className="mr-1.5 h-4 w-4" aria-hidden />
                  Export workbook
                </span>
              )}
            </Button>
            <span className="text-xs text-muted-foreground">
              Built from the funder&rsquo;s own template. Its formulas are never rewritten.
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Budget against actual ({rows.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {quarter === null && (
            <p className="mb-4 max-w-prose text-sm text-destructive">
              This period is not labelled as a quarter, so no budget column can be matched
              to it and every figure below reads zero. Rename it Q1 to Q4.
            </p>
          )}
          <VarianceTable periodId={period.id} locked={locked} rows={rows} />
        </CardContent>
      </Card>

      <PeriodReconciliation
        periodId={period.id}
        locked={locked}
        initial={{
          amountTransferred: field(period.amountTransferred),
          fundingBudgeted: field(period.fundingBudgeted),
          balanceBroughtForward: field(period.balanceBroughtForward),
          bankBalance: field(period.bankBalance),
          invoiceNumber: period.invoiceNumber ?? '',
          preparedByName: period.preparedByName ?? '',
          preparedOn: dateField(period.preparedOn),
          approvedByName: period.approvedByName ?? '',
          approvedOn: dateField(period.approvedOn),
          incomeLines: period.incomeLines.map((l) => ({
            label: l.label,
            budget: String(l.budget),
            actual: String(l.actual),
          })),
        }}
      />
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'warn'
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p
          className={`mt-1 text-xl font-semibold tabular-nums ${
            tone === 'warn' ? 'text-warning' : ''
          }`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  )
}
