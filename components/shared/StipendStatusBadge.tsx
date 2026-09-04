import { Badge } from '@/components/ui/badge'
import { STIPEND_STATUS, statusMeta } from '@/lib/status-colors'
import type { StipendStatus } from '@prisma/client'

export function StipendStatusBadge({ status }: { status: StipendStatus }) {
  const config = statusMeta(STIPEND_STATUS, status)
  return <Badge variant={config.variant}>{config.label}</Badge>
}
