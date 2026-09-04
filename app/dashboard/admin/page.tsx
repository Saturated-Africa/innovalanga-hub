import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Users, UserCheck, Briefcase, Eye, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'

export default async function AdminPage() {
  const session = await getSession()
  if (!session || session.user.role !== 'super_admin') redirect('/dashboard')

  const [roleCounts, pendingSetup, recentUsers] = await Promise.all([
    prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
    // Innovators who registered but have no profile yet
    prisma.user.findMany({
      where: { role: 'innovator', innovatorProfile: null },
      select: { id: true, name: true, email: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.findMany({
      take: 8,
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    }),
  ])

  const countByRole = Object.fromEntries(
    roleCounts.map((r) => [r.role, r._count._all])
  )

  const ROLE_LABELS: Record<string, string> = {
    super_admin: 'Super Admins',
    facilitator: 'Facilitators',
    mentor: 'Mentors',
    innovator: 'Innovators',
    funder_viewer: 'Funder Viewers',
  }

  const ROLE_COLOURS: Record<string, string> = {
    super_admin: 'text-purple-600 bg-purple-50',
    facilitator: 'text-info bg-info/10',
    mentor: 'text-success bg-success/10',
    innovator: 'text-warning bg-warning/10',
    funder_viewer: 'text-gray-600 bg-muted',
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Admin Panel"
        description="User management and account setup"
        actions={
          <>
        <Button asChild>
          <Link href="/dashboard/admin/users">Manage Users</Link>
        </Button>
          </>
        }
      />

      {/* Role summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Object.entries(ROLE_LABELS).map(([role, label]) => (
          <Card key={role}>
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={`text-3xl font-bold mt-1 ${ROLE_COLOURS[role]?.split(' ')[0]}`}>
                {countByRole[role] ?? 0}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pending innovator setup */}
      {pendingSetup.length > 0 && (
        <Card className="border-warning/25 bg-warning/10/40">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <CardTitle className="text-base text-warning">
                {pendingSetup.length} innovator{pendingSetup.length !== 1 ? 's' : ''} need profile setup
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingSetup.map((u) => (
                <div key={u.id} className="flex items-center justify-between rounded-md bg-card border px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{u.name}</p>
                    <p className="text-xs text-muted-foreground">{u.email} · registered {formatDate(u.createdAt)}</p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/dashboard/admin/setup-innovator/${u.id}`}>Set up profile</Link>
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent registrations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Accounts</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-border">
            {recentUsers.map((u) => (
              <div key={u.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-medium">{u.name}</p>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs capitalize">
                    {u.role.replace('_', ' ')}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{formatDate(u.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
