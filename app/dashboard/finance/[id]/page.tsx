import { getSession } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/PageHeader'
import { formatDate } from '@/lib/utils'
import { tenantScope } from '@/lib/tenant-db'
import { ArrowLeft, Download } from 'lucide-react'
import { TransactionsTable } from '@/components/finance/TransactionsTable'

const money = (n: number) =>
  n.toLocaleString('en-ZA', { style: 'currency', currency: 'ZAR' })

const CATEGORY_LABEL: Record<string, string> = {
  Personnel: 'Personnel',
  Operational: 'Operational',
  CapitalEquipment: 'Capital equipment',
  Consumables: 'Consumables',
}

export default async function FinanceProjectPage({ params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.user.role !== 'super_admin') redirect('/dashboard')

  const scope = await tenantScope(session)
  if (!scope) redirect('/dashboard')
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  const project = await prisma.financeProject.findFirst({
    where: { id: params.id, programmeId },
    include: {
      periods: { orderBy: { label: 'asc' } },
      activities: { orderBy: { sortOrder: 'asc' } },
    },
  })
  if (!project) notFound()

  const transactions = await prisma.financeTransaction.findMany({
    where: { projectId: project.id },
    orderBy: { spentOn: 'asc' },
    include: {
      activity: { select: { code: true } },
      proofs: {
        select: {
          id: true,
          kind: true,
          filename: true,
          shareToken: true,
          revokedAt: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  const spend = transactions.reduce((sum, t) => sum + Number(t.amount), 0)
  const budget = project.activities.reduce(
    (sum, a) =>
      sum +
      Number(a.budgetQ1) +
      Number(a.budgetQ2) +
      Number(a.budgetQ3) +
      Number(a.budgetQ4),
    0
  )
  const uncoded = transactions.filter((t) => !t.activityId).length
  // A revoked link is not evidence the funder can open, so it does not count
  // towards a transaction being covered.
  const withoutProof = transactions.filter(
    (t) => t.proofs.filter((p) => !p.revokedAt).length === 0
  ).length

  return (
    <div className="space-y-6">
      <PageHeader
        title={project.institutionName}
        description={
          project.agreementNumber
            ? `Agreement ${project.agreementNumber} · ${formatDate(project.startDate)} to ${formatDate(project.endDate)}`
            : `${formatDate(project.startDate)} to ${formatDate(project.endDate)}`
        }
        actions={
          <Button variant="ghost" asChild>
            <Link href="/dashboard/finance">
              <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden />
              All projects
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Budget" value={money(budget)} />
        <Stat label="Spend" value={money(spend)} />
        <Stat
          label="Not coded to an activity"
          value={String(uncoded)}
          tone={uncoded ? 'warn' : undefined}
        />
        <Stat
          label="Without proof"
          value={String(withoutProof)}
          tone={withoutProof ? 'warn' : undefined}
        />
      </div>

      {uncoded > 0 && (
        <p className="max-w-prose text-sm text-muted-foreground">
          The funder&rsquo;s workbook carries no activity code on a transaction row, so
          nothing imported arrives coded. Coding each transaction to an activity is what
          lets an activity&rsquo;s actual spend be computed from all of its transactions,
          rather than hand-linked to a single row as the spreadsheet does today.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reporting periods</CardTitle>
        </CardHeader>
        <CardContent>
          {project.periods.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet.</p>
          ) : (
            <div className="space-y-2">
              {project.periods.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 text-sm"
                >
                  <Link
                    href={`/dashboard/finance/${project.id}/periods/${p.id}`}
                    className="link-brand font-medium"
                  >
                    {p.label}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(p.startDate)} to {formatDate(p.endDate)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    transferred{' '}
                    {p.amountTransferred ? money(Number(p.amountTransferred)) : 'not set'}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge variant={p.status === 'Open' ? 'secondary' : 'default'}>
                      {p.status}
                    </Badge>
                    {/* Generated on demand rather than stored, so it always
                        reflects the current coding and evidence. */}
                    {/* The reconciliation figures, written reasons and
                        declaration all live on the period, so the export is
                        reached through it rather than beside it. */}
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/dashboard/finance/${project.id}/periods/${p.id}`}>
                        <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                        Reconcile and export
                      </Link>
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Transactions ({transactions.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <TransactionsTable
            projectId={project.id}
            activities={project.activities.map((a) => ({
              id: a.id,
              code: a.code,
              details: a.details,
              costCategory: a.costCategory,
            }))}
            transactions={transactions.map((t) => ({
              id: t.id,
              // Dates and decimals cannot cross to a Client Component as they
              // are, so both are converted here rather than in the component.
              spentOn: formatDate(t.spentOn),
              supplier: t.supplier,
              description: t.description,
              amount: Number(t.amount),
              costCategory: t.costCategory,
              activityId: t.activityId,
              activityCode: t.activity?.code ?? null,
              proofs: t.proofs.map((pr) => ({
                id: pr.id,
                kind: pr.kind,
                filename: pr.filename,
                shareToken: pr.shareToken,
                revokedAt: pr.revokedAt ? pr.revokedAt.toISOString() : null,
              })),
            }))}
          />
        </CardContent>
      </Card>
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
