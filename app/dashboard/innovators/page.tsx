import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/shared/DataTable'
import { formatDate } from '@/lib/utils'
import { UserPlus } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { tenantScope } from '@/lib/tenant-db'
import { InnovatorsTable } from './InnovatorsTable'

export default async function InnovatorsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!['super_admin', 'facilitator'].includes(session.user.role)) redirect('/dashboard')

  const scope = await tenantScope(session)
  if (!scope) redirect('/dashboard')
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope

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

      <InnovatorsTable rows={rows} />
    </div>
  )
}
