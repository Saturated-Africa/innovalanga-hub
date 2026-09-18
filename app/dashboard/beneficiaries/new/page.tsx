import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/shared/PageHeader'
import { tenantScope } from '@/lib/tenant-db'
import { CaptureClient } from './CaptureClient'

export default async function NewBeneficiaryPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!['super_admin', 'facilitator'].includes(session.user.role)) redirect('/dashboard')

  const scope = await tenantScope(session)
  if (!scope) redirect('/dashboard')
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope

  const cohorts = await prisma.cohort.findMany({
    where: { programmeId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Beneficiary Capturing Form"
        description="Complete with the beneficiary present. They sign on this device, then the centre accepts."
      />
      <CaptureClient cohorts={cohorts} />
    </div>
  )
}
