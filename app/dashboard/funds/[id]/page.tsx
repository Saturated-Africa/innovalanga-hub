import { getSession } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/PageHeader'
import { formatDate } from '@/lib/utils'
import { systemPrisma } from '@/lib/prisma'
import { fundSummary } from '@/lib/funds/queries'
import { fromCents, toCents } from '@/lib/funds/rules'
import { ArrowLeft } from 'lucide-react'
import { FundAdmin } from '@/components/funds/FundAdmin'

/**
 * One fund: where the money came from, who it is earmarked for, and what has
 * been promised out of it.
 *
 * Platform level, on the owning connection, for the same reason as the register
 * it came from: a fund is not owned by any one programme.
 */
export default async function FundPage({ params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.user.role !== 'super_admin') redirect('/dashboard')

  const fund = await fundSummary(systemPrisma, params.id)
  if (!fund) notFound()

  const [record, receipts, allocations, grants, programmes] = await Promise.all([
    systemPrisma.fund.findUnique({
      where: { id: params.id },
      select: { notes: true, currency: true },
    }),
    systemPrisma.fundReceipt.findMany({
      where: { fundId: params.id },
      orderBy: { receivedOn: 'desc' },
    }),
    systemPrisma.fundAllocation.findMany({
      where: { fundId: params.id },
      include: { programme: { select: { id: true, name: true } } },
      orderBy: { amount: 'desc' },
    }),
    systemPrisma.grant.findMany({
      where: { fundId: params.id },
      include: {
        innovator: { select: { firstName: true, lastName: true } },
        programme: { select: { name: true } },
        tranches: { select: { amount: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    systemPrisma.programme.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ])

  const b = fund.balances

  // Awarded per programme, so each allocation shows what is left of it.
  const awardedByProgramme = new Map<string, number>()
  for (const g of grants) {
    if (g.status === 'Cancelled') continue
    const key = g.programmeId
    awardedByProgramme.set(key, (awardedByProgramme.get(key) ?? 0) + toCents(Number(g.awardedAmount)))
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={fund.name}
        description={`${fund.funderName}${fund.reference ? ` · ${fund.reference}` : ''} · ${formatDate(fund.startDate)} to ${formatDate(fund.endDate)}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={fund.status === 'Active' ? 'default' : 'secondary'}>
              {fund.status}
            </Badge>
            <Button variant="ghost" asChild>
              <Link href="/dashboard/funds">
                <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden />
                All funds
              </Link>
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Committed" value={money(b.committed)} />
        <Stat label="Received" value={money(b.received)} />
        <Stat
          label="Cash on hand"
          value={money(b.cashOnHand)}
          tone={b.cashOnHand < 0 ? 'bad' : undefined}
          hint="Received less disbursed"
        />
        <Stat
          label="Free cash"
          value={money(b.freeCash)}
          tone={b.freeCash < 0 ? 'bad' : undefined}
          hint="Cash on hand less what is already promised to participants"
        />
      </div>

      {b.freeCash < 0 && (
        <p className="max-w-prose rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          This fund has promised {money(b.payableCommitments)} to participants and holds{' '}
          {money(b.cashOnHand)}. That is legitimate while a drawdown is expected and worth
          chasing if one is not.
        </p>
      )}

      <FundAdmin
        fundId={fund.id}
        currency={record?.currency ?? 'ZAR'}
        uncommitted={fromCents(b.uncommitted)}
        programmes={programmes.map((p) => ({
          id: p.id,
          name: p.name,
          allocated: fromCents(
            toCents(
              Number(allocations.find((a) => a.programmeId === p.id)?.amount ?? 0)
            )
          ),
        }))}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Allocated to programmes</CardTitle>
        </CardHeader>
        <CardContent>
          {allocations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing allocated yet. Until a programme has an allocation it cannot award
              grants from this fund.
            </p>
          ) : (
            <div className="space-y-3">
              {allocations.map((a) => {
                const allocated = toCents(Number(a.amount))
                const awarded = awardedByProgramme.get(a.programmeId) ?? 0
                const left = allocated - awarded
                return (
                  <div key={a.id} className="rounded-lg border border-border px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="font-medium">{a.programme.name}</p>
                      <dl className="flex gap-6 text-right text-sm tabular-nums">
                        <Figure label="Allocated" value={money(allocated)} />
                        <Figure label="Awarded" value={money(awarded)} />
                        <Figure
                          label="Left"
                          value={money(left)}
                          tone={left < 0 ? 'bad' : undefined}
                        />
                      </dl>
                    </div>
                    {a.note && (
                      <p className="mt-1 text-xs text-muted-foreground">{a.note}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Money received ({receipts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {receipts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing recorded as received. The commitment is a promise until it arrives.
            </p>
          ) : (
            <div className="space-y-2">
              {receipts.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2 text-sm last:border-0"
                >
                  <span>{formatDate(r.receivedOn)}</span>
                  <span className="text-muted-foreground">{r.reference ?? '—'}</span>
                  <span
                    className={`font-medium tabular-nums ${Number(r.amount) < 0 ? 'text-destructive' : ''}`}
                  >
                    {money(toCents(Number(r.amount)))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Grants from this fund ({grants.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {grants.length === 0 ? (
            <p className="text-sm text-muted-foreground">No grants awarded yet.</p>
          ) : (
            <div className="space-y-2">
              {grants.map((g) => {
                const paid = g.tranches
                  .filter((t) => t.status === 'Paid')
                  .reduce((t, x) => t + toCents(Number(x.amount)), 0)
                return (
                  <div
                    key={g.id}
                    className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2 text-sm last:border-0"
                  >
                    <span className="min-w-0">
                      <Link href={`/dashboard/grants/${g.id}`} className="link-brand font-medium">
                        {g.entityName}
                      </Link>
                      <span className="text-muted-foreground">
                        {' '}
                        · {g.innovator.firstName} {g.innovator.lastName} · {g.programme.name}
                      </span>
                    </span>
                    <span className="flex items-center gap-4">
                      <Badge variant="secondary">{g.status}</Badge>
                      <span className="tabular-nums">
                        {money(paid)} of {money(toCents(Number(g.awardedAmount)))}
                      </span>
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {record?.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{record.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`font-medium ${tone === 'bad' ? 'text-destructive' : ''}`}>{value}</dd>
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string
  value: string
  tone?: 'bad'
  hint?: string
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p
          className={`mt-1 text-xl font-semibold tabular-nums ${
            tone === 'bad' ? 'text-destructive' : ''
          }`}
        >
          {value}
        </p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

function money(c: number): string {
  return fromCents(c).toLocaleString('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
  })
}
