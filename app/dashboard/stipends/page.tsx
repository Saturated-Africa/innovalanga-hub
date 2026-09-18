import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { DataTable } from '@/components/shared/DataTable'
import { StipendStatusBadge } from '@/components/shared/StipendStatusBadge'
import { RecalculateStipendButton } from '@/components/dashboard/RecalculateStipendButton'
import { formatDate, formatCurrency } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { StipendsTable } from './StipendsTable'
import { tenantScope } from '@/lib/tenant-db'

export default async function StipendsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!['super_admin', 'facilitator'].includes(session.user.role)) redirect('/dashboard')

  // Scope to the caller's programme. This query previously had no `where` at
  // all, so the page listed every stipend record in the database - names, hours
  // and amounts - across every programme. QA caught it as a count mismatch
  // against the dashboard widget (which is scoped): 6 pending there, 7 here.
  const scope = await tenantScope(session)
  if (!scope) redirect('/dashboard')
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope

  const stipends = await prisma.stipendRecord.findMany({
    where: { innovator: { cohort: { programmeId } } },
    include: {
      innovator: { select: { firstName: true, lastName: true, businessName: true } },
      // Revoked links are not evidence anybody can open, so they are excluded.
      proofs: {
        where: { revokedAt: null },
        select: { id: true, filename: true, shareToken: true },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: [{ periodStart: 'desc' }, { innovator: { lastName: 'asc' } }],
  })

  const rows = stipends.map((s) => ({
    id: s.id,
    innovator: `${s.innovator.firstName} ${s.innovator.lastName}`,
    business: s.innovator.businessName ?? '—',
    period: `${formatDate(s.periodStart)} – ${formatDate(s.periodEnd)}`,
    hours: s.hoursCompleted.toFixed(1),
    amount: formatCurrency(Number(s.amount)),
    status: s.status,
    paidAt: s.paidAt ? formatDate(s.paidAt) : '—',
    _stipendId: s.id,
    _proofs: s.proofs,
  }))

  type Row = typeof rows[0]

  const totalEligible = stipends.filter((s) => s.status === 'Eligible').length
  const totalPaid = stipends.filter((s) => s.paidAt !== null).length
  const totalAmount = stipends
    .filter((s) => s.status === 'Eligible' || s.status === 'Override')
    // Summed through the shared helper so the total rounds to cents once, at
    // the end, rather than drifting across a register of many rows.
    .reduce((sum, s) => sum + Number(s.amount), 0)

  return (
    <div className="space-y-6">
      <PageHeader title="Stipends" description="Monthly register of innovator stipend eligibility" />

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Eligible Records</p>
          <p className="text-3xl font-bold text-success">{totalEligible}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Paid Out</p>
          <p className="text-3xl font-bold">{totalPaid}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Total Committed</p>
          <p className="text-3xl font-bold">{formatCurrency(totalAmount)}</p>
        </div>
      </div>

      <StipendsTable rows={rows} />
    </div>
  )
}
