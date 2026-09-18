import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { formatDate } from '@/lib/utils'
import { systemPrisma } from '@/lib/prisma'
import { fundSummaries } from '@/lib/funds/queries'
import { fromCents } from '@/lib/funds/rules'
import { Landmark, TriangleAlert } from 'lucide-react'
import { NewFundDialog } from '@/components/funds/NewFundDialog'

/**
 * The fund register.
 *
 * Read on the owning connection, and restricted to the fund manager, because a
 * fund sits above programmes: one backs several, and a programme can be
 * co-funded. What each programme may draw is an allocation, and that is where
 * the tenant boundary is drawn.
 */

export default async function FundsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.user.role !== 'super_admin') redirect('/dashboard')

  const funds = await fundSummaries(systemPrisma)
  const programmes = await systemPrisma.programme.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })

  const total = funds.reduce(
    (t, f) => ({
      committed: t.committed + f.balances.committed,
      received: t.received + f.balances.received,
      disbursed: t.disbursed + f.balances.disbursed,
      cash: t.cash + f.balances.cashOnHand,
    }),
    { committed: 0, received: 0, disbursed: 0, cash: 0 }
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Funds under management"
        description="Capital committed by funders, what has arrived, and what has been promised away."
        actions={<NewFundDialog />}
      />

      {funds.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="No funds yet"
          description="Add the first fund to start tracking capital, allocations and grants."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Committed by funders" value={money(total.committed)} />
            <Stat label="Received to date" value={money(total.received)} />
            <Stat label="Disbursed to date" value={money(total.disbursed)} />
            <Stat
              label="Cash on hand"
              value={money(total.cash)}
              tone={total.cash < 0 ? 'bad' : undefined}
            />
          </div>

          <div className="space-y-4">
            {funds.map((fund) => {
              const b = fund.balances
              return (
                <Card key={fund.id}>
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle className="text-base">
                          <Link href={`/dashboard/funds/${fund.id}`} className="link-brand">
                            {fund.name}
                          </Link>
                        </CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {fund.funderName}
                          {fund.reference ? ` · ${fund.reference}` : ''} ·{' '}
                          {formatDate(fund.startDate)} to {formatDate(fund.endDate)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {b.freeCash < 0 && (
                          <span
                            className="flex items-center gap-1 text-xs text-warning"
                            title="More is promised to participants than the fund is holding."
                          >
                            <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
                            promised beyond cash
                          </span>
                        )}
                        <Badge variant={fund.status === 'Active' ? 'default' : 'secondary'}>
                          {fund.status}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    <CommitmentBar
                      committed={b.committed}
                      allocated={b.allocated}
                      awarded={b.awarded}
                      disbursed={b.disbursed}
                    />

                    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
                      <Figure label="Committed" value={money(b.committed)} />
                      <Figure label="Received" value={money(b.received)} />
                      <Figure label="Allocated" value={money(b.allocated)} />
                      <Figure label="Awarded" value={money(b.awarded)} />
                      <Figure label="Disbursed" value={money(b.disbursed)} />
                      <Figure
                        label="Cash on hand"
                        value={money(b.cashOnHand)}
                        tone={b.cashOnHand < 0 ? 'bad' : undefined}
                      />
                    </dl>

                    <p className="text-xs text-muted-foreground">
                      {fund.programmeCount === 0
                        ? 'Not yet allocated to any programme.'
                        : `Allocated across ${fund.programmeCount} programme${fund.programmeCount === 1 ? '' : 's'}`}
                      {fund.grantCount > 0 &&
                        ` · ${fund.grantCount} grant${fund.grantCount === 1 ? '' : 's'}`}
                      {fund.feeRate !== null &&
                        ` · fee ${(fund.feeRate * 100).toFixed(2)}% on ${fund.feeBasis?.toLowerCase()}, ${money(fund.feeEarned)} earned`}
                    </p>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </>
      )}

      {programmes.length === 0 && (
        <p className="text-sm text-muted-foreground">
          There are no programmes to allocate a fund to yet.
        </p>
      )}
    </div>
  )
}

/**
 * Commitment, drawn to scale.
 *
 * One bar rather than four numbers, because the question a fund manager asks is
 * always about the gaps: between committed and allocated, between awarded and
 * disbursed. Segments are nested rather than stacked, since each is a subset of
 * the one before it.
 */
function CommitmentBar({
  committed,
  allocated,
  awarded,
  disbursed,
}: {
  committed: number
  allocated: number
  awarded: number
  disbursed: number
}) {
  if (committed <= 0) return null
  const pct = (n: number) => Math.min(100, Math.max(0, (n / committed) * 100))

  return (
    <div>
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0 bg-brand-volt-deep/25"
          style={{ width: `${pct(allocated)}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 bg-brand-volt-deep/55"
          style={{ width: `${pct(awarded)}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 bg-brand-volt-deep"
          style={{ width: `${pct(disbursed)}%` }}
        />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <Key className="bg-brand-volt-deep" label="disbursed" />
        <Key className="bg-brand-volt-deep/55" label="awarded" />
        <Key className="bg-brand-volt-deep/25" label="allocated" />
        <Key className="bg-muted" label="uncommitted" />
      </div>
    </div>
  )
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-2 w-2 rounded-sm ${className}`} aria-hidden />
      {label}
    </span>
  )
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'bad'
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 font-medium tabular-nums ${tone === 'bad' ? 'text-destructive' : ''}`}>
        {value}
      </dd>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'bad' }) {
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
