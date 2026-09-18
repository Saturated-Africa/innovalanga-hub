'use client'

import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/shared/DataTable'

/** See InnovatorsTable for why the columns live in a client component. */
export interface AssessmentRow {
  innovatorId: string
  innovator: string
  business: string
  period: string
  trl: number
  brl: number
  irl: number
  assessedBy: string
  locked: string
  date: string
}

export function AssessmentsTable({ rows }: { rows: AssessmentRow[] }) {
  return (
    <DataTable
      data={rows}
      searchKeys={['innovator', 'business', 'period', 'assessedBy']}
      csvFilename="assessments.csv"
      emptyMessage="No assessments recorded yet."
      columns={[
        {
          key: 'innovator',
          label: 'Innovator',
          sortable: true,
          render: (row) => (
            <Link href={`/dashboard/innovators/${row.innovatorId}`} className="link-brand">
              {row.innovator}
            </Link>
          ),
        },
        { key: 'business', label: 'Business' },
        {
          key: 'period',
          label: 'Period',
          render: (row) => <Badge variant="outline">{row.period}</Badge>,
        },
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
        { key: 'assessedBy', label: 'Assessor' },
        {
          key: 'locked',
          label: 'Locked',
          render: (row) =>
            row.locked === 'Yes' ? (
              <Badge variant="secondary">Locked</Badge>
            ) : (
              <Badge variant="outline">Draft</Badge>
            ),
        },
        { key: 'date', label: 'Date', sortable: true },
      ]}
    />
  )
}
