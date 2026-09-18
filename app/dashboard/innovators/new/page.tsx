import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { FolderPlus } from 'lucide-react'
import { tenantScope } from '@/lib/tenant-db'
import { NewInnovatorForm } from './NewInnovatorForm'

export default async function NewInnovatorPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!['super_admin', 'facilitator'].includes(session.user.role)) redirect('/dashboard')

  const scope = await tenantScope(session)
  if (!scope) redirect('/dashboard')
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope

  const [cohorts, regions] = await Promise.all([
    prisma.cohort.findMany({
      where: { programmeId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.region.findMany({
      where: { programmeId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  // An innovator must belong to a cohort, so without one there is nothing to
  // add them to. Say that plainly rather than rendering a form that cannot
  // submit.
  if (cohorts.length === 0) {
    return (
      <div className="max-w-2xl space-y-6">
        <PageHeader
          title="Add innovator"
          description="Create a participant account and profile."
        />
        <EmptyState
          icon={FolderPlus}
          title="No cohorts yet"
          description="Every innovator belongs to a cohort. Create one first, then come back."
          action={
            <Button asChild>
              <Link href="/dashboard/cohorts">Go to cohorts</Link>
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Add innovator"
        description="Creates the participant's account and their profile in one step."
      />
      <NewInnovatorForm cohorts={cohorts} regions={regions} />
    </div>
  )
}
