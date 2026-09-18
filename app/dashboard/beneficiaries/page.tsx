import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { UserPlus, ClipboardList } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { tenantScope } from '@/lib/tenant-db'

const STATUS_LABEL: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  Draft: { label: 'Draft', variant: 'outline' },
  AwaitingAcceptance: { label: 'Awaiting acceptance', variant: 'secondary' },
  Accepted: { label: 'Accepted', variant: 'default' },
  Withdrawn: { label: 'Withdrawn', variant: 'outline' },
}

export default async function BeneficiariesPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!['super_admin', 'facilitator'].includes(session.user.role)) redirect('/dashboard')

  const scope = await tenantScope(session)
  if (!scope) redirect('/dashboard')
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope

  // No ID numbers and no signature images: a list needs neither.
  const records = await prisma.beneficiaryRecord.findMany({
    where: { programmeId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      fullName: true,
      email: true,
      status: true,
      projectTitle: true,
      createdAt: true,
      cohort: { select: { name: true } },
    },
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Beneficiaries"
        description="Signed capturing forms for funder reporting."
        actions={
          <Button asChild>
            <Link href="/dashboard/beneficiaries/new">
              <UserPlus className="mr-2 h-4 w-4" aria-hidden />
              Capture beneficiary
            </Link>
          </Button>
        }
      />

      {records.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No beneficiaries captured yet"
          description="Capture the funder's beneficiary form with the beneficiary present. They sign on the device and the centre accepts."
          action={
            <Button asChild>
              <Link href="/dashboard/beneficiaries/new">Capture the first one</Link>
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="border-b border-border bg-muted/60">
              <tr>
                {['Name', 'Project', 'Cohort', 'Captured', 'Status'].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {records.map((r) => {
                const status = STATUS_LABEL[r.status] ?? { label: r.status, variant: 'outline' as const }
                return (
                  <tr key={r.id} className="transition-colors hover:bg-muted/40">
                    <td className="px-4 py-2.5">
                      <Link href={`/dashboard/beneficiaries/${r.id}`} className="link-brand font-medium">
                        {r.fullName}
                      </Link>
                      <p className="text-xs text-muted-foreground">{r.email}</p>
                    </td>
                    <td className="px-4 py-2.5">{r.projectTitle ?? '—'}</td>
                    <td className="px-4 py-2.5">{r.cohort?.name ?? '—'}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(r.createdAt)}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
