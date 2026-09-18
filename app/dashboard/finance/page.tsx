import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Upload, Wallet } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { tenantScope } from '@/lib/tenant-db'

const money = (n: number) =>
  n.toLocaleString('en-ZA', { style: 'currency', currency: 'ZAR' })

export default async function FinancePage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.user.role !== 'super_admin') redirect('/dashboard')

  const scope = await tenantScope(session)
  if (!scope) redirect('/dashboard')
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  const projects = await prisma.financeProject.findMany({
    where: { programmeId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      institutionName: true,
      agreementNumber: true,
      startDate: true,
      endDate: true,
      _count: { select: { activities: true, transactions: true, periods: true } },
    },
  })

  // Spend per project, summed in the database so decimals stay exact.
  const spend = await prisma.financeTransaction.groupBy({
    by: ['projectId'],
    _sum: { amount: true },
  })
  const spendByProject = new Map(spend.map((s) => [s.projectId, Number(s._sum.amount ?? 0)]))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Project finance"
        description="Quarterly financial reporting to funders."
        actions={
          <Button asChild>
            <Link href="/dashboard/finance/import">
              <Upload className="mr-2 h-4 w-4" aria-hidden />
              Import workbook
            </Link>
          </Button>
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No projects yet"
          description="Import the funder's workbook to bring across the project plan and a period of transactions."
          action={
            <Button asChild>
              <Link href="/dashboard/finance/import">Import a workbook</Link>
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[42rem] text-sm">
            <thead className="border-b border-border bg-muted/60">
              <tr>
                {['Institution', 'Agreement', 'Period', 'Activities', 'Transactions', 'Spend'].map((h) => (
                  <th key={h} scope="col" className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {projects.map((p) => (
                <tr key={p.id} className="transition-colors hover:bg-muted/40">
                  <td className="px-4 py-2.5">
                    <Link href={`/dashboard/finance/${p.id}`} className="link-brand font-medium">
                      {p.institutionName}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{p.agreementNumber ?? '—'}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                    {formatDate(p.startDate)} – {formatDate(p.endDate)}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">{p._count.activities}</td>
                  <td className="px-4 py-2.5 tabular-nums">{p._count.transactions}</td>
                  <td className="px-4 py-2.5 tabular-nums">{money(spendByProject.get(p.id) ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
