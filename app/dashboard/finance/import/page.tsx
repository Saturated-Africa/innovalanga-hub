import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/shared/PageHeader'
import { tenantScope } from '@/lib/tenant-db'
import { ImportClient } from './ImportClient'

export default async function FinanceImportPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  // Project accounting is a finance function rather than a delivery one.
  if (session.user.role !== 'super_admin') redirect('/dashboard')

  const scope = await tenantScope(session)
  if (!scope) redirect('/dashboard')
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  const projects = await prisma.financeProject.findMany({
    where: { programmeId },
    select: { id: true, institutionName: true },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Import a funder workbook"
        description="Read the file, check what it contains, then keep it."
      />
      <ImportClient projects={projects} />
    </div>
  )
}
