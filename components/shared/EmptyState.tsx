import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * The standard empty state.
 *
 * Replaces two inconsistent tiers that existed before: four copy-pasted dashed
 * Cards in the M&E and IP modules, and ~18 bare `<p>` tags elsewhere with
 * vertical padding that varied between `py-4`, `py-8`, `py-10` and `py-12`.
 *
 * `inline` renders the compact form for empty regions inside an existing card
 * (where wrapping in another Card would double the border); the default
 * renders the full dashed panel for a whole-page or whole-section empty.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  inline = false,
  className,
}: {
  icon?: LucideIcon
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  inline?: boolean
  className?: string
}) {
  const body = (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-center',
        inline ? 'py-8' : 'py-14'
      )}
    >
      {Icon ? (
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
          <Icon className="h-5 w-5 text-muted-foreground" aria-hidden />
        </span>
      ) : null}
      <div className="space-y-1">
        <p className="font-medium text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  )

  if (inline) return <div className={className}>{body}</div>

  return (
    <Card className={cn('border-dashed bg-transparent shadow-none', className)}>
      <CardContent className="p-0">{body}</CardContent>
    </Card>
  )
}
