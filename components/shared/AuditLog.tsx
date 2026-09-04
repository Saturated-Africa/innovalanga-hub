import { prisma } from '@/lib/prisma'
import { formatDateTime } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { AUDIT_ACTION_VARIANT } from '@/lib/status-colors'

interface AuditLogProps {
  innovatorId: string
  limit?: number
}

export async function AuditLog({ innovatorId, limit = 50 }: AuditLogProps) {
  const entries = await prisma.auditLog.findMany({
    where: { innovatorId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">No audit history yet.</p>
    )
  }

  return (
    <ScrollArea className="max-h-96">
      <div className="space-y-0 divide-y divide-border">
        {entries.map((e) => (
          <div key={e.id} className="flex items-start gap-3 py-3 px-1">
            <Badge
              size="sm"
              variant={AUDIT_ACTION_VARIANT[e.action] ?? 'muted'}
              className="mt-0.5 shrink-0 capitalize"
            >
              {e.action}
            </Badge>
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <span className="font-medium capitalize">{e.entityType}</span>
                {e.actorId && (
                  <span className="text-muted-foreground text-xs ml-1">by {e.actorId}</span>
                )}
              </p>
              {e.diff && typeof e.diff === 'object' && Object.keys(e.diff).length > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                  {JSON.stringify(e.diff).slice(0, 120)}
                  {JSON.stringify(e.diff).length > 120 ? '…' : ''}
                </p>
              )}
            </div>
            <span className="text-xs text-muted-foreground shrink-0">{formatDateTime(e.createdAt)}</span>
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}
