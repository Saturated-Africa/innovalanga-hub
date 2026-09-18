import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/shared/PageHeader'
import { ChangePassword } from '@/components/account/ChangePassword'
import { systemPrisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

/**
 * Your own account.
 *
 * Read on the owning connection because an account belongs to a person, not to
 * a programme - the person may be a platform administrator with no programme at
 * all. Nothing here is scoped by tenancy because nothing here is another
 * tenant's to see: it is only ever the caller's own record.
 */

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super admin',
  facilitator: 'Facilitator',
  mentor: 'Mentor',
  innovator: 'Innovator',
  funder_viewer: 'Funder viewer',
}

export default async function AccountPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const user = await systemPrisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, name: true, role: true, password: true, createdAt: true },
  })
  if (!user) redirect('/login')

  /*
   * Is this account still on the password it was seeded with?
   *
   * Checked here, on the server, by comparing against the known seeded values
   * rather than by storing a flag. A flag would have to be set correctly at
   * creation and would quietly go stale; this cannot be wrong.
   *
   * The seed file is committed, so these are public knowledge. Anyone who finds
   * the repository has them.
   */
  const SEEDED = ['Admin@1234', 'Facilitator@1234', 'Mentor@1234', 'Innovator@1234', 'Funder@1234']
  let usingSeededPassword = false
  if (user.password) {
    for (const candidate of SEEDED) {
      if (await bcrypt.compare(candidate, user.password)) {
        usingSeededPassword = true
        break
      }
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Your account"
        description="Who you are signed in as, and your password."
      />

      {usingSeededPassword && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3">
          <p className="font-medium text-destructive">
            This account is still using the password it was created with.
          </p>
          <p className="mt-1 max-w-prose text-sm">
            That password is written in the project&rsquo;s own source code, which means
            anyone who can read the repository can sign in as you. Change it before any
            real participant information goes into this platform.
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Signed in as</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Name</dt>
              <dd className="mt-0.5 font-medium">{user.name}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Email</dt>
              <dd className="mt-0.5 font-medium">{user.email}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Role</dt>
              <dd className="mt-0.5">
                <Badge variant="secondary">{ROLE_LABELS[user.role] ?? user.role}</Badge>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <ChangePassword
        hasPassword={Boolean(user.password)}
        email={user.email}
        name={user.name}
        urgent={usingSeededPassword}
      />
    </div>
  )
}
