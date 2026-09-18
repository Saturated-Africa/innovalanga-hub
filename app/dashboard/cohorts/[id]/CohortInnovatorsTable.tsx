'use client'

import Link from 'next/link'
import { DataTable } from '@/components/shared/DataTable'

/** See InnovatorsTable for why the columns live in a client component. */
export interface CohortInnovatorRow {
  id: string
  name: string
  email: string
  business: string
  trl: number | string
  brl: number | string
  irl: number | string
  assessments: number
  sessions: number
}

export function CohortInnovatorsTable({ rows }: { rows: CohortInnovatorRow[] }) {
  return (
    <DataTable
      data={rows}
      searchKeys={['name', 'email', 'business']}
      emptyMessage="No innovators in this cohort yet."
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
        { key: 'business', label: 'Business' },
        {
          key: 'trl',
          label: 'TRL',
          align: 'right',
          sortable: true,
          render: (row) => <span className="font-semibold text-chart-1">{row.trl}</span>,
        },
        {
          key: 'brl',
          label: 'BRL',
          align: 'right',
          sortable: true,
          render: (row) => <span className="font-semibold text-chart-2">{row.brl}</span>,
        },
        {
          key: 'irl',
          label: 'IRL',
          align: 'right',
          sortable: true,
          render: (row) => <span className="font-semibold text-chart-3">{row.irl}</span>,
        },
        { key: 'assessments', label: 'Assessments', align: 'right' },
        { key: 'sessions', label: 'Sessions', align: 'right' },
      ]}
    />
  )
}
