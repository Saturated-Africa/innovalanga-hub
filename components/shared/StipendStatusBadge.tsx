import { Badge } from '@/components/ui/badge'
import type { StipendStatus } from '@prisma/client'

const STATUS_CONFIG: Record<StipendStatus, { label: string; variant: 'success' | 'info' | 'warning' | 'destructive' | 'secondary' | 'outline' }> = {
  Eligible: { label: 'Eligible', variant: 'success' },
  NotEligible: { label: 'Not Eligible', variant: 'destructive' },
  Pending: { label: 'Pending', variant: 'warning' },
  Override: { label: 'Override', variant: 'secondary' },
}

export function StipendStatusBadge({ status }: { status: StipendStatus }) {
  const config = STATUS_CONFIG[status]
  return <Badge variant={config.variant}>{config.label}</Badge>
}
