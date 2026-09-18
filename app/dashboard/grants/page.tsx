import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { tenantScope } from '@/lib/tenant-db'
import { grantSummaries, programmeAllocation } from '@/lib/funds/queries'
import { fromCents } from '@/lib/funds/rules'
import { HandCoins } from 'lucide-react'

/**
 * Grants in this programme.
 *
 * Scoped by the tenant connection, so a facilitator sees their own programme's
 * awards and the share of each fund their programme was allocated - not what
 * the fund holds overall, which is the fund manager's business.
 */

const VIEWERS = ['super_admin', 'facilitator', 'funder_viewer']

export default async function GrantsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!VIEWERS.includes(session.user.role)) redirect('/dashboard')

  const scope = await tenantScope(session)
  if (!scope) redirect('/dashboard')
  const { db: prisma } = scope

  const [grants, allocation] = await Promise.all([
    grantSummaries(prisma),
    programmeAllocation(prisma),
  ])

  const awaiting = grants.filter((g) => g.payableCount > 0).length
  const unreviewed = grants.reduce((t, g) => t + g.unreviewed, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Grants"
        description="Awards to participants, paid in tranches as each one is approved."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Allocated to this programme" value={money(allocation.allocated)} />
        <Stat label="Awarded" value={money(allocation.awarded)} />
        <Stat
          label="Left to award"
          value={money(allocation.remaining)}
          tone={allocation.remaining < 0 ? 'bad' : undefined}
        />
        <Stat
          label="Tranches ready to pay"
          value={String(awaiting)}
          tone={awaiting > 0 ? 'warn' : undefined}
        />
      </div>

      {allocation.funds.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Drawing on{' '}
          {allocation.funds
            .map((f) => `${f.fundName} (${money(f.allocated - f.awarded)} left)`)
            .join(', ')}
          .
        </p>
      )}

      {unreviewed > 0 && (
        <p className="max-w-prose rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          {money(unreviewed)} of participant spend is waiting to be reviewed. Money already
          paid out is not accounted for until it is.
        </p>
      )}

      {grants.length === 0 ? (
        <EmptyState
          icon={HandCoins}
          title="No grants yet"
          description={
            allocation.allocated === 0
              ? 'This programme has no fund allocation yet, so there is nothing to award from.'
              : 'Award the first grant to a participant to get started.'
          }
        />
      ) : (
        <div className="space-y-3">
          {grants.map((g) => {
            const b = g.balances
            return (
              <Card key={g.id}>
                <CardContent className="pt-6">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0">
                      <p className="font-medium">
                        <Link href={`/dashboard/grants/${g.id}`} className="link-brand">
                          {g.entityName}
                        </Link>
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {g.participant} · {entityLabel(g.entityType)} · {g.fundName}
                        {g.reference ? ` · ${g.reference}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {g.payableCount > 0 && (
                        <Badge variant="outline">
                          {g.payableCount} ready to pay
                        </Badge>
                      )}
                      <Badge variant={g.status === 'Active' ? 'default' : 'secondary'}>
                        {g.status}
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="absolute inset-y-0 left-0 bg-brand-volt-deep"
                        style={{ width: `${pct(b.paid, b.awarded)}%` }}
                      />
                    </div>
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
                    <Figure label="Awarded" value={money(b.awarded)} />
                    <Figure label="Paid" value={money(b.paid)} />
                    <Figure label="Outstanding" value={money(b.outstanding)} />
                    <Figure
                      label="Unaccounted"
                      value={money(b.unaccounted)}
                      tone={b.unaccounted > 0 ? 'warn' : undefined}
                    />
                  </dl>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

const ENTITY_LABELS: Record<string, string> = {
  PtyLtd: '(Pty) Ltd',
  NPC: 'NPC',
  CloseCorporation: 'CC',
  SoleProprietor: 'Sole proprietor',
  Trust: 'Trust',
  Cooperative: 'Co-operative',
  Other: 'Other',
}

function entityLabel(t: string): string {
  return ENTITY_LABELS[t] ?? t
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.min(100, Math.max(0, (part / whole) * 100))
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`font-medium tabular-nums ${tone === 'warn' ? 'text-warning' : ''}`}>
        {value}
      </dd>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'bad' | 'warn' }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p
          className={`mt-1 text-xl font-semibold tabular-nums ${
            tone === 'bad' ? 'text-destructive' : tone === 'warn' ? 'text-warning' : ''
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
