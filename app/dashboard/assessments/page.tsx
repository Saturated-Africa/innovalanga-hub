import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/shared/DataTable'
import { formatDate } from '@/lib/utils'
import { ClipboardPlus } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'

const PERIOD_LABELS: Record<string, string> = {
  baseline: 'Baseline',
  month_3: 'Month 3',
  month_6: 'Month 6',
  month_9: 'Month 9',
  final: 'Final',
}

export default async function AssessmentsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!['super_admin', 'facilitator'].includes(session.user.role)) redirect('/dashboard')

  const assessments = await prisma.assessment.findMany({
    include: {
      innovator: { select: { firstName: true, lastName: true, businessName: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const rows = assessments.map((a) => ({
    id: a.id,
    innovatorId: a.innovatorId,
    innovator: `${a.innovator.firstName} ${a.innovator.lastName}`,
    business: a.innovator.businessName ?? '—',
    period: PERIOD_LABELS[a.period] ?? a.period,
    trl: a.trlScore,
    brl: a.brlScore,
    irl: a.irlScore,
    assessedBy: a.assessedBy,
    locked: a.lockedAt ? 'Yes' : 'No',
    date: formatDate(a.createdAt),
  }))

  type Row = typeof rows[0]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assessments"
        description={<>{assessments.length} total records</>}
        actions={
          <>
        <Button asChild>
          <Link href="/dashboard/assessments/new">
            <ClipboardPlus className="mr-2 h-4 w-4" />
            New Assessment
          </Link>
        </Button>
          </>
        }
      />

      <DataTable
        data={rows}
        searchKeys={['innovator', 'business', 'period', 'assessedBy']}
        csvFilename="assessments.csv"
        columns={[
          {
            key: 'innovator',
            label: 'Innovator',
            sortable: true,
            render: (row: Row) => (
              <Link href={`/dashboard/innovators/${row.innovatorId}`} className="link-brand">
                {row.innovator}
              </Link>
            ),
          },
          { key: 'business', label: 'Business' },
          {
            key: 'period',
            label: 'Period',
            render: (row: Row) => <Badge variant="outline">{row.period}</Badge>,
          },
          {
            key: 'trl',
            label: 'TRL',
            render: (row: Row) => <span className="font-mono font-bold text-chart-1">{row.trl}</span>,
          },
          {
            key: 'brl',
            label: 'BRL',
            render: (row: Row) => <span className="font-mono font-bold text-chart-2">{row.brl}</span>,
          },
          {
            key: 'irl',
            label: 'IRL',
            render: (row: Row) => <span className="font-mono font-bold text-chart-3">{row.irl}</span>,
          },
          { key: 'assessedBy', label: 'Assessor' },
          {
            key: 'locked',
            label: 'Locked',
            render: (row: Row) => (
              row.locked === 'Yes'
                ? <Badge variant="secondary">Locked</Badge>
                : <Badge variant="outline">Draft</Badge>
            ),
          },
          { key: 'date', label: 'Date', sortable: true },
        ]}
      />
    </div>
  )
}
