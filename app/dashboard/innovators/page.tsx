import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/shared/DataTable'
import { formatDate } from '@/lib/utils'
import { UserPlus } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { resolveProgrammeId } from '@/lib/scope'

export default async function InnovatorsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!['super_admin', 'facilitator'].includes(session.user.role)) redirect('/dashboard')

  const programmeId = await resolveProgrammeId(session)
  if (!programmeId) redirect('/dashboard')

  const innovators = await prisma.innovatorProfile.findMany({
    where: { cohort: { programmeId } },
    include: {
      user: { select: { email: true } },
      cohort: { select: { name: true } },
      region: { select: { name: true } },
      assessments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      _count: { select: { bookings: true } },
    },
    orderBy: { lastName: 'asc' },
  })

  const rows = innovators.map((i) => {
    const latest = i.assessments[0]
    return {
      id: i.id,
      name: `${i.firstName} ${i.lastName}`,
      email: i.user.email,
      cohort: i.cohort.name,
      region: i.region?.name ?? '—',
      businessName: i.businessName ?? '—',
      sector: i.businessSector ?? '—',
      latestTRL: latest?.trlScore ?? '—',
      latestBRL: latest?.brlScore ?? '—',
      latestIRL: latest?.irlScore ?? '—',
      sessions: i._count.bookings,
      createdAt: formatDate(i.createdAt),
    }
  })

  type Row = typeof rows[0]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Innovators"
        description={<>{innovators.length} registered innovators</>}
        actions={
          <>
        {session.user.role === 'super_admin' && (
          <Button asChild>
            <Link href="/dashboard/innovators/new">
              <UserPlus className="mr-2 h-4 w-4" />
              Add Innovator
            </Link>
          </Button>
        )}
          </>
        }
      />

      <DataTable
        data={rows}
        searchKeys={['name', 'email', 'businessName', 'cohort']}
        csvFilename="innovators.csv"
        columns={[
          {
            key: 'name',
            label: 'Name',
            sortable: true,
            render: (row: Row) => (
              <Link href={`/dashboard/innovators/${row.id}`} className="link-brand">
                {row.name}
              </Link>
            ),
          },
          { key: 'cohort', label: 'Cohort', sortable: true },
          {
            key: 'region',
            label: 'Region',
            render: (row: Row) => (
              <Badge variant="outline" className="text-xs">{row.region}</Badge>
            ),
          },
          { key: 'businessName', label: 'Business', sortable: true },
          { key: 'sector', label: 'Sector' },
          {
            key: 'latestTRL',
            label: 'TRL',
            render: (row: Row) => (
              <span className="font-mono font-semibold text-chart-1">{row.latestTRL}</span>
            ),
          },
          {
            key: 'latestBRL',
            label: 'BRL',
            render: (row: Row) => (
              <span className="font-mono font-semibold text-chart-2">{row.latestBRL}</span>
            ),
          },
          {
            key: 'latestIRL',
            label: 'IRL',
            render: (row: Row) => (
              <span className="font-mono font-semibold text-chart-3">{row.latestIRL}</span>
            ),
          },
          { key: 'sessions', label: 'Sessions' },
        ]}
      />
    </div>
  )
}
