import { getSession } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/PageHeader'
import { formatDate } from '@/lib/utils'
import { tenantScope } from '@/lib/tenant-db'
import { systemPrisma } from '@/lib/prisma'
import { fundSummary } from '@/lib/funds/queries'
import {
  canPayTranche,
  toCents,
  fromCents,
  grantBalances,
  grantStatusOptions,
  type Tranche,
  type GrantStatus,
} from '@/lib/funds/rules'
import { ArrowLeft } from 'lucide-react'
import { TrancheSchedule } from '@/components/funds/TrancheSchedule'
import { ExpenditureReview } from '@/components/funds/ExpenditureReview'
import { GrantStatusControl } from '@/components/funds/GrantStatusControl'

/**
 * One grant: the award, its payment schedule, and what the participant has done
 * with the money.
 *
 * Every tranche is asked the same question the payment route asks, here on the
 * server, so the buttons reflect the actual rule rather than a second guess at
 * it. A tranche that cannot be paid says why before anybody clicks.
 */

const VIEWERS = ['super_admin', 'facilitator', 'funder_viewer']

export default async function GrantPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession()
  if (!session) redirect('/login')
  if (!VIEWERS.includes(session.user.role)) redirect('/dashboard')

  const scope = await tenantScope(session)
  if (!scope) redirect('/dashboard')
  const { db: prisma } = scope

  const grant = await prisma.grant.findFirst({
    where: { id: params.id },
    include: {
      fund: { select: { id: true, name: true, currency: true } },
      innovator: { select: { id: true, firstName: true, lastName: true } },
      tranches: {
        orderBy: { sequence: 'asc' },
        include: {
          // Proof that the money left. Read for every viewer including a funder,
          // because reconciling disbursements is what the link is for.
          proofs: {
            where: { revokedAt: null },
            select: { id: true, filename: true, shareToken: true },
          },
        },
      },
      expenditures: {
        orderBy: { spentOn: 'desc' },
        include: {
          proofs: {
            where: { revokedAt: null },
            select: { id: true, filename: true, shareToken: true },
          },
        },
      },
    },
  })
  if (!grant) notFound()

  // The fund's position is platform level, so it is read on the owning
  // connection. Without it the payment check cannot say whether the money is
  // actually there.
  const fund = await fundSummary(systemPrisma, grant.fundId)

  const paid = grant.tranches.filter((t) => t.status === 'Paid')
  const reported = grant.expenditures.filter((e) => e.status !== 'Rejected')
  const accepted = grant.expenditures.filter((e) => e.status === 'Accepted')
  const unreviewed = grant.expenditures.filter((e) => e.status === 'Submitted')

  const balances = grantBalances({
    awarded: toCents(Number(grant.awardedAmount)),
    paid: paid.reduce((t, x) => t + toCents(Number(x.amount)), 0),
    reported: reported.reduce((t, x) => t + toCents(Number(x.amount)), 0),
    accepted: accepted.reduce((t, x) => t + toCents(Number(x.amount)), 0),
  })

  const shape = (t: (typeof grant.tranches)[number]): Tranche => ({
    sequence: t.sequence,
    amount: toCents(Number(t.amount)),
    status: t.status as Tranche['status'],
  })

  const rows = grant.tranches.map((t) => {
    const verdict = fund
      ? canPayTranche({
          grantStatus: grant.status as never,
          tranche: shape(t),
          allTranches: grant.tranches.map(shape),
          fund: fund.balances,
          unreviewedExpenditure: unreviewed.reduce(
            (sum, e) => sum + toCents(Number(e.amount)),
            0
          ),
        })
      : { allowed: false, reasons: ['The fund could not be read.'], warnings: [] }

    return {
      id: t.id,
      sequence: t.sequence,
      amount: fromCents(toCents(Number(t.amount))),
      status: t.status,
      plannedDate: t.plannedDate ? formatDate(t.plannedDate) : null,
      paidOn: t.paidOn ? formatDate(t.paidOn) : null,
      paymentReference: t.paymentReference,
      conditions: t.conditions,
      withheldReason: t.withheldReason,
      approvedBy: t.approvedBy,
      canPay: verdict.allowed,
      blockedBecause: verdict.reasons,
      warnings: verdict.warnings,
      proofs: t.proofs.map((proof) => ({
        id: proof.id,
        filename: proof.filename,
        href: `/proof/${proof.shareToken}`,
      })),
    }
  })

  const canAct = session.user.role !== 'funder_viewer'

  return (
    <div className="space-y-6">
      <PageHeader
        title={grant.entityName}
        description={`${grant.innovator.firstName} ${grant.innovator.lastName} · ${grant.fund.name}${grant.reference ? ` · ${grant.reference}` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <GrantStatusControl
              grantId={grant.id}
              status={grant.status}
              options={grantStatusOptions(grant.status as GrantStatus)}
              canChange={session.user.role === 'super_admin'}
            />
            <Button variant="ghost" asChild>
              <Link href="/dashboard/grants">
                <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden />
                All grants
              </Link>
            </Button>
          </div>
        }
      />

      {grant.status === 'Draft' && (
        <p className="max-w-prose rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          This grant is still a draft, so no tranche on it can be paid. Approving and then
          activating it is what commits the fund&rsquo;s money to it.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Awarded" value={money(balances.awarded)} />
        <Stat label="Paid" value={money(balances.paid)} />
        <Stat label="Outstanding" value={money(balances.outstanding)} />
        <Stat
          label="Unaccounted"
          value={money(balances.unaccounted)}
          tone={balances.unaccounted > 0 ? 'warn' : undefined}
          hint={
            balances.accountedRatio === null
              ? 'Nothing paid yet'
              : `${Math.round(balances.accountedRatio * 100)}% of paid money accounted for`
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Purpose</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="whitespace-pre-wrap text-sm">{grant.purpose}</p>
          <p className="text-xs text-muted-foreground">
            {entityLabel(grant.entityType)}
            {grant.entityRegistrationNumber
              ? ` · registration ${grant.entityRegistrationNumber}`
              : ''}
            {grant.startDate ? ` · ${formatDate(grant.startDate)}` : ''}
            {grant.endDate ? ` to ${formatDate(grant.endDate)}` : ''}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Payment schedule ({grant.tranches.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 max-w-prose text-sm text-muted-foreground">
            A tranche is paid only once the one before it has been settled. That is the
            funder&rsquo;s control over money already handed out, so the rule is enforced
            wherever a payment is recorded, not just on this screen.
          </p>
          <TrancheSchedule
            grantId={grant.id}
            currency={grant.fund.currency}
            rows={rows}
            canAct={canAct}
            canPay={session.user.role === 'super_admin'}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Reported spend ({grant.expenditures.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 max-w-prose text-sm text-muted-foreground">
            Accepting an expense is what turns money paid out into money accounted for.
            Querying one sends it back to the participant with a note, which is the right
            answer to a thin description or a missing receipt.
          </p>
          <ExpenditureReview
            grantId={grant.id}
            canReview={canAct}
            rows={grant.expenditures.map((e) => ({
              id: e.id,
              spentOn: formatDate(e.spentOn),
              supplier: e.supplier,
              description: e.description,
              amount: money(toCents(Number(e.amount))),
              category: e.category,
              status: e.status,
              reviewedBy: e.reviewedBy,
              reviewNote: e.reviewNote,
              proofs: e.proofs.map((proof) => ({
                id: proof.id,
                filename: proof.filename,
                href: `/proof/${proof.shareToken}`,
              })),
            }))}
          />
        </CardContent>
      </Card>
    </div>
  )
}

const ENTITY_LABELS: Record<string, string> = {
  PtyLtd: '(Pty) Ltd',
  NPC: 'NPC',
  CloseCorporation: 'Close corporation',
  SoleProprietor: 'Sole proprietor',
  Trust: 'Trust',
  Cooperative: 'Co-operative',
  Other: 'Other',
}
function entityLabel(t: string): string {
  return ENTITY_LABELS[t] ?? t
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string
  value: string
  tone?: 'warn'
  hint?: string
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p
          className={`mt-1 text-xl font-semibold tabular-nums ${tone === 'warn' ? 'text-warning' : ''}`}
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
