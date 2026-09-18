'use client'

import { DataTable } from '@/components/shared/DataTable'
import { StipendStatusBadge } from '@/components/shared/StipendStatusBadge'
import { RecalculateStipendButton } from '@/components/dashboard/RecalculateStipendButton'
import { StipendProofButton } from '@/components/dashboard/StipendProofButton'
import type { StipendStatus } from '@prisma/client'

/** See InnovatorsTable for why the columns live in a client component. */
export interface StipendRow {
  innovator: string
  business: string
  period: string
  hours: string
  amount: string
  status: string
  paidAt: string
  _stipendId: string
  _proofs: { id: string; filename: string; shareToken: string }[]
}

export function StipendsTable({ rows }: { rows: StipendRow[] }) {
  return (
    <DataTable
      data={rows}
      searchKeys={['innovator', 'business', 'period']}
      csvFilename="stipends.csv"
      emptyMessage="No stipend records for this period."
      columns={[
        { key: 'innovator', label: 'Innovator', sortable: true },
        { key: 'business', label: 'Business' },
        { key: 'period', label: 'Period' },
        { key: 'hours', label: 'Hours', align: 'right', sortable: true },
        { key: 'amount', label: 'Amount', align: 'right' },
        {
          key: 'status',
          label: 'Status',
          render: (row) => <StipendStatusBadge status={row.status as StipendStatus} />,
        },
        { key: 'paidAt', label: 'Paid Date' },
        {
          key: '_proofs',
          label: 'Proof',
          render: (row) => (
            <StipendProofButton
              stipendId={row._stipendId}
              innovator={row.innovator}
              proofs={row._proofs}
              paidAt={row.paidAt === '—' ? null : row.paidAt}
            />
          ),
        },
        {
          key: '_stipendId',
          label: '',
          render: (row) => <RecalculateStipendButton stipendRecordId={row._stipendId} />,
        },
      ]}
    />
  )
}
