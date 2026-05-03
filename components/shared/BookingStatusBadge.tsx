import { Badge } from '@/components/ui/badge'
import type { BookingStatus } from '@prisma/client'

const STATUS_CONFIG: Record<BookingStatus, { label: string; variant: 'success' | 'info' | 'warning' | 'destructive' | 'secondary' | 'outline' }> = {
  Confirmed: { label: 'Confirmed', variant: 'info' },
  InProgress: { label: 'In Progress', variant: 'warning' },
  Completed: { label: 'Completed', variant: 'success' },
  Cancelled: { label: 'Cancelled', variant: 'destructive' },
  Rescheduled: { label: 'Rescheduled', variant: 'secondary' },
  NoShowPendingReview: { label: 'No-show', variant: 'outline' },
}

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const config = STATUS_CONFIG[status]
  return <Badge variant={config.variant}>{config.label}</Badge>
}
