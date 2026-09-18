import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { homeRouteFor } from '@/lib/home-route'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Users, ClipboardList, Calendar, DollarSign } from 'lucide-react'
import { BookingStatusBadge } from '@/components/shared/BookingStatusBadge'
import { tenantScope, tenantScopeFor } from '@/lib/tenant-db'

export default async function DashboardPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const role = session.user.role

  // Role redirects. The destinations live in lib/home-route.ts so this and the
  // entry splash cannot drift apart.
  const home = homeRouteFor(role)
  if (home !== '/dashboard') redirect(home)

  // Scope every figure to the caller's programme. These counts were previously
  // database-wide, so a facilitator saw other funders' totals on their homepage.
  const scope = await tenantScope(session)
  if (!scope) redirect('/login')
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  const innovatorScope = { cohort: { programmeId } }

  // Stats for admin/facilitator
  const [totalInnovators, totalAssessments, totalBookings, pendingStipends] = await Promise.all([
    prisma.innovatorProfile.count({ where: innovatorScope }),
    prisma.assessment.count({ where: { innovator: innovatorScope } }),
    prisma.booking.count({ where: { status: 'Completed', innovator: innovatorScope } }),
    prisma.stipendRecord.count({ where: { status: 'Pending', innovator: innovatorScope } }),
  ])

  const stats = [
    { label: 'Total Innovators', value: totalInnovators, icon: Users, color: 'text-info bg-info/10' },
    { label: 'Assessments Done', value: totalAssessments, icon: ClipboardList, color: 'text-success bg-success/10' },
    { label: 'Sessions Completed', value: totalBookings, icon: Calendar, color: 'text-purple-600 bg-purple-50' },
    { label: 'Stipends Pending', value: pendingStipends, icon: DollarSign, color: 'text-warning bg-warning/10' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Welcome back, {session.user.name}. Here&apos;s a snapshot of the programme.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
              <div className={`p-2 rounded-lg ${stat.color}`}>
                <stat.icon className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RecentActivity programmeId={programmeId} />
        <ProgrammeProgress programmeId={programmeId} />
      </div>
    </div>
  )
}

async function RecentActivity({ programmeId }: { programmeId: string }) {
  // Its own connection rather than one handed down as a prop: these render as
  // separate server components, and a database client is not a prop.
  const prisma = await tenantScopeFor(programmeId)

  const recentBookings = await prisma.booking.findMany({
    where: { innovator: { cohort: { programmeId } } },
    take: 5,
    orderBy: { updatedAt: 'desc' },
    include: {
      innovator: { select: { firstName: true, lastName: true } },
      mentor: { select: { firstName: true, lastName: true } },
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent Sessions</CardTitle>
      </CardHeader>
      <CardContent>
        {recentBookings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent sessions.</p>
        ) : (
          <div className="space-y-3">
            {recentBookings.map((b) => (
              <div key={b.id} className="flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium">
                    {b.innovator.firstName} {b.innovator.lastName}
                  </span>
                  <span className="text-muted-foreground">
                    {' '}
                    &rarr; {b.mentor.firstName} {b.mentor.lastName}
                  </span>
                </div>
                <BookingStatusBadge status={b.status} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

async function ProgrammeProgress({ programmeId }: { programmeId: string }) {
  const prisma = await tenantScopeFor(programmeId)

  const cohorts = await prisma.cohort.findMany({
    where: { programmeId },
    include: {
      region: { select: { name: true } },
      _count: { select: { innovators: true } },
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Active Cohorts</CardTitle>
      </CardHeader>
      <CardContent>
        {cohorts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cohorts yet.</p>
        ) : (
          <div className="space-y-4">
            {cohorts.map((c) => (
              <div key={c.id}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-muted-foreground">{c._count.innovators} innovators</span>
                </div>
                {c.region && <p className="text-xs text-muted-foreground">{c.region.name}</p>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
