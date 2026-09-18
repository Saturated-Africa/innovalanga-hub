import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { formatDate } from '@/lib/utils'
import { tenantScope } from '@/lib/tenant-db'
import { callerInnovatorId } from '@/lib/authz'
import { fromCents, toCents, grantBalances } from '@/lib/funds/rules'
import { canSubmitExpenditure } from '@/lib/funds/expenditure'
import type { GrantStatus } from '@/lib/funds/rules'
import { SubmitExpenditure } from '@/components/funds/SubmitExpenditure'
import { ParticipantExpenditures } from '@/components/funds/ParticipantExpenditures'
import { HandCoins } from 'lucide-react'

/**
 * The participant's own grant, and the money they have to account for.
 *
 * Scoped twice on purpose. The tenant connection confines this to one
 * programme, and row-level security is programme-scoped rather than
 * person-scoped, so the participant's own id is applied as well - without it
 * this page would show a participant every grant awarded to their peers.
 *
 * Whether reporting is possible is decided by the same function the API uses,
 * so the button is disabled for exactly the reasons a submission would be
 * refused, with the reason said out loud rather than left as a dead control.
 */
export default async function MyGrantPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.user.role !== 'innovator') redirect('/dashboard')

  const innovatorId = await callerInnovatorId(session)
  if (!innovatorId) redirect('/dashboard')

  const scope = await tenantScope(session)
  if (!scope) redirect('/dashboard')
  const { db: prisma } = scope

  const grants = await prisma.grant.findMany({
    where: { innovatorId },
    include: {
      fund: { select: { name: true } },
      tranches: { orderBy: { sequence: 'asc' } },
      expenditures: { orderBy: { spentOn: 'desc' } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="space-y-6">
      <PageHeader
        title="My grant"
        description="What you were awarded, what has been paid, and what you have accounted for."
      />

      {grants.length === 0 ? (
        <EmptyState
          icon={HandCoins}
          title="No grant yet"
          description="If your programme awards you a grant, it will appear here along with its payment schedule."
        />
      ) : (
        grants.map((grant) => {
          const paidTranches = grant.tranches.filter((t) => t.status === 'Paid')
          const paid = paidTranches.reduce((t, x) => t + toCents(Number(x.amount)), 0)
          const reported = grant.expenditures
            .filter((e) => e.status !== 'Rejected')
            .reduce((t, x) => t + toCents(Number(x.amount)), 0)
          const accepted = grant.expenditures
            .filter((e) => e.status === 'Accepted')
            .reduce((t, x) => t + toCents(Number(x.amount)), 0)

          const balances = grantBalances({
            awarded: toCents(Number(grant.awardedAmount)),
            paid,
            reported,
            accepted,
          })

          const verdict = canSubmitExpenditure({
            grantStatus: grant.status as GrantStatus,
            paid,
            alreadyReported: reported,
            // A nominal amount, because this asks "can anything be reported at
            // all" rather than judging a particular expense.
            amount: 1,
            spentOn: today,
            today,
            grantStartDate: grant.startDate
              ? grant.startDate.toISOString().slice(0, 10)
              : null,
            grantEndDate: grant.endDate ? grant.endDate.toISOString().slice(0, 10) : null,
          })

          const queried = grant.expenditures.filter((e) => e.status === 'Queried').length

          return (
            <Card key={grant.id}>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="text-base">{grant.entityName}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {grant.fund.name}
                    {grant.reference ? ` · ${grant.reference}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={grant.status === 'Active' ? 'default' : 'secondary'}>
                    {grant.status}
                  </Badge>
                  <SubmitExpenditure
                    grantId={grant.id}
                    tranches={paidTranches.map((t) => ({
                      id: t.id,
                      label: `Tranche ${t.sequence} — ${money(toCents(Number(t.amount)))}`,
                    }))}
                    disabledReason={
                      verdict.allowed ? undefined : verdict.reasons.join(' ')
                    }
                  />
                </div>
              </CardHeader>

              <CardContent className="space-y-6">
                {!verdict.allowed && (
                  <p className="max-w-prose rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    {verdict.reasons.join(' ')}
                  </p>
                )}

                {queried > 0 && (
                  <p className="max-w-prose rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
                    {queried === 1
                      ? 'One of your expenses has a question on it.'
                      : `${queried} of your expenses have questions on them.`}{' '}
                    Answer below so they can be accepted.
                  </p>
                )}

                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <Stat label="Awarded" value={money(balances.awarded)} />
                  <Stat label="Paid to you" value={money(balances.paid)} />
                  <Stat label="Still to come" value={money(balances.outstanding)} />
                  <Stat
                    label="To account for"
                    value={money(balances.unaccounted)}
                    tone={balances.unaccounted > 0 ? 'warn' : undefined}
                  />
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-medium">Payment schedule</h3>
                  <div className="space-y-2">
                    {grant.tranches.map((t) => (
                      <div
                        key={t.id}
                        className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2 text-sm last:border-0 last:pb-0"
                      >
                        <span>
                          Tranche {t.sequence}
                          {t.conditions ? (
                            <span className="text-muted-foreground"> · {t.conditions}</span>
                          ) : null}
                        </span>
                        <span className="flex items-center gap-4">
                          <span className="text-xs text-muted-foreground">
                            {t.paidOn
                              ? `Paid ${formatDate(t.paidOn)}`
                              : t.plannedDate
                                ? `Planned ${formatDate(t.plannedDate)}`
                                : 'No date set'}
                          </span>
                          <Badge variant={t.status === 'Paid' ? 'default' : 'secondary'}>
                            {t.status}
                          </Badge>
                          <span className="tabular-nums">
                            {money(toCents(Number(t.amount)))}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-medium">
                    What you have reported ({grant.expenditures.length})
                  </h3>
                  <ParticipantExpenditures
                    grantId={grant.id}
                    rows={grant.expenditures.map((e) => ({
                      id: e.id,
                      spentOn: formatDate(e.spentOn),
                      supplier: e.supplier,
                      description: e.description,
                      amount: money(toCents(Number(e.amount))),
                      status: e.status,
                      reviewNote: e.reviewNote,
                    }))}
                  />
                </div>
              </CardContent>
            </Card>
          )
        })
      )}
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
    <div className="rounded-lg border border-border px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${
          tone === 'warn' ? 'text-warning' : ''
        }`}
      >
        {value}
      </p>
    </div>
  )
}

function money(c: number): string {
  return fromCents(c).toLocaleString('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
  })
}
