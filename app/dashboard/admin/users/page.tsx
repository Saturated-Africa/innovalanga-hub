import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/utils'
import { CreateUserDialog } from './CreateUserDialog'
import { UserRoleSelect } from './UserRoleSelect'
import { DeleteUserButton } from './DeleteUserButton'
import Link from 'next/link'
import { UserPlus } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'

export default async function AdminUsersPage() {
  const session = await getSession()
  if (!session || session.user.role !== 'super_admin') redirect('/dashboard')

  const users = await prisma.user.findMany({
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      innovatorProfile: { select: { id: true, cohortId: true } },
      mentorProfile: { select: { id: true } },
    },
  })

  const ROLE_COLOURS: Record<string, string> = {
    super_admin: 'border-purple-200 text-purple-700 bg-purple-50',
    facilitator: 'border-info/25 text-info bg-info/10',
    mentor: 'border-success/25 text-success bg-success/10',
    innovator: 'border-warning/25 text-warning bg-warning/10',
    funder_viewer: 'border-gray-200 text-foreground bg-muted',
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description={<>{users.length} accounts on the platform</>}
        actions={
          <>
        <CreateUserDialog>
          <Button>
            <UserPlus className="mr-2 h-4 w-4" />
            Add User
          </Button>
        </CreateUserDialog>
          </>
        }
      />

      <div className="rounded-lg border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Email</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Role</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Joined</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Profile</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-muted/20">
                <td className="px-4 py-3 font-medium">{u.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                <td className="px-4 py-3">
                  <UserRoleSelect
                    userId={u.id}
                    currentRole={u.role}
                    isSelf={u.id === session.user.id}
                  />
                </td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(u.createdAt)}</td>
                <td className="px-4 py-3">
                  {u.role === 'innovator' && !u.innovatorProfile && (
                    <Button asChild size="sm" variant="outline" className="text-warning border-amber-300 bg-warning/10 hover:bg-amber-100 text-xs h-7">
                      <Link href={`/dashboard/admin/setup-innovator/${u.id}`}>Setup needed</Link>
                    </Button>
                  )}
                  {u.role === 'innovator' && u.innovatorProfile && (
                    <Button asChild size="sm" variant="ghost" className="text-xs h-7">
                      <Link href={`/dashboard/innovators/${u.innovatorProfile.id}`}>View profile</Link>
                    </Button>
                  )}
                  {u.role === 'mentor' && u.mentorProfile && (
                    <span className="text-xs text-muted-foreground">Mentor profile active</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {u.id !== session.user.id && (
                    <DeleteUserButton userId={u.id} userName={u.name} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
