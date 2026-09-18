'use client'

import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/shared/DataTable'

/**
 * Column definitions live here rather than in the page.
 *
 * `DataTable` is a client component, and a Server Component cannot pass a
 * function across the boundary: React throws "Functions cannot be passed
 * directly to Client Components". It works in `next dev` and fails in a
 * production build, which is why it only appeared once this was deployed.
 *
 * The server page fetches and serialises the rows; this component owns the
 * render functions.
 */
export interface InnovatorRow {
  id: string
  name: string
  email: string
  cohort: string
  region: string
  businessName: string
  sector: string
  latestTRL: number | string
  latestBRL: number | string
  latestIRL: number | string
  sessions: number
  createdAt: string
}

export function InnovatorsTable({ rows }: { rows: InnovatorRow[] }) {
  return (
    <DataTable
      data={rows}
      searchKeys={['name', 'email', 'businessName', 'cohort']}
      csvFilename="innovators.csv"
      emptyMessage="No innovators on this programme yet."
      columns={[
        {
          key: 'name',
          label: 'Name',
          sortable: true,
          render: (row) => (
            <Link href={`/dashboard/innovators/${row.id}`} className="link-brand">
              {row.name}
            </Link>
          ),
        },
        { key: 'cohort', label: 'Cohort', sortable: true },
        {
          key: 'region',
          label: 'Region',
          render: (row) => <Badge variant="outline">{row.region}</Badge>,
        },
        { key: 'businessName', label: 'Business', sortable: true },
        { key: 'sector', label: 'Sector' },
        {
          key: 'latestTRL',
          label: 'TRL',
          align: 'right',
          sortable: true,
          render: (row) => <span className="font-semibold text-chart-1">{row.latestTRL}</span>,
        },
        {
          key: 'latestBRL',
          label: 'BRL',
          align: 'right',
          sortable: true,
          render: (row) => <span className="font-semibold text-chart-2">{row.latestBRL}</span>,
        },
        {
          key: 'latestIRL',
          label: 'IRL',
          align: 'right',
          sortable: true,
          render: (row) => <span className="font-semibold text-chart-3">{row.latestIRL}</span>,
        },
        { key: 'sessions', label: 'Sessions', align: 'right' },
      ]}
    />
  )
}
