import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { DataTable } from '@/components/shared/DataTable'
import { StipendStatusBadge } from '@/components/shared/StipendStatusBadge'
import { RecalculateStipendButton } from '@/components/dashboard/RecalculateStipendButton'
import { formatDate, formatCurrency } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'

export default async function StipendsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!['super_admin', 'facilitator'].includes(session.user.role)) redirect('/dashboard')

  const stipends = await prisma.stipendRecord.findMany({
    include: {
      innovator: { select: { firstName: true, lastName: true, businessName: true } },
    },
    orderBy: [{ periodStart: 'desc' }, { innovator: { lastName: 'asc' } }],
  })

  const rows = stipends.map((s) => ({
    id: s.id,
    innovator: `${s.innovator.firstName} ${s.innovator.lastName}`,
    business: s.innovator.businessName ?? '—',
    period: `${formatDate(s.periodStart)} – ${formatDate(s.periodEnd)}`,
    hours: s.hoursCompleted.toFixed(1),
    amount: formatCurrency(s.amount),
    status: s.status,
    paidAt: s.paidAt ? formatDate(s.paidAt) : '—',
    _stipendId: s.id,
  }))

  type Row = typeof rows[0]

  const totalEligible = stipends.filter((s) => s.status === 'Eligible').length
  const totalPaid = stipends.filter((s) => s.paidAt !== null).length
  const totalAmount = stipends
    .filter((s) => s.status === 'Eligible' || s.status === 'Override')
    .reduce((sum, s) => sum + s.amount, 0)

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

      <DataTable
        data={rows}
        searchKeys={['innovator', 'business', 'period']}
        csvFilename="stipends.csv"
        columns={[
          { key: 'innovator', label: 'Innovator', sortable: true },
          { key: 'business', label: 'Business' },
          { key: 'period', label: 'Period' },
          { key: 'hours', label: 'Hours' },
          { key: 'amount', label: 'Amount' },
          {
            key: 'status',
            label: 'Status',
            render: (row: Row) => <StipendStatusBadge status={row.status as any} />,
          },
          { key: 'paidAt', label: 'Paid Date' },
          {
            key: '_stipendId',
            label: '',
            render: (row: Row) => <RecalculateStipendButton stipendRecordId={row._stipendId as string} />,
          },
        ]}
      />
    </div>
  )
}
