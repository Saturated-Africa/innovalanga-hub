import { Badge } from '@/components/ui/badge'
import { BOOKING_STATUS, statusMeta } from '@/lib/status-colors'
import type { BookingStatus } from '@prisma/client'

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const config = statusMeta(BOOKING_STATUS, status)
  return <Badge variant={config.variant}>{config.label}</Badge>
}

/** The bare dot, for dense lists and timelines that can't fit a full badge. */
export function BookingStatusDot({ status }: { status: BookingStatus }) {
  const config = statusMeta(BOOKING_STATUS, status)
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${config.dot}`}
      title={config.label}
      aria-label={config.label}
    />
  )
}
