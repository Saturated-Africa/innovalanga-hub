import { cn } from '@/lib/utils'

/**
 * The standard page heading.
 *
 * Replaces the two hand-copied variants of this block that appeared across ~33
 * dashboard pages (`text-2xl font-bold` + a muted subtitle, with and without a
 * trailing action slot). Centralising it also fixes the heading hierarchy,
 * which had drifted — some pages used `text-2xl`, others `text-3xl`, and two
 * added their own `text-gray-900`.
 *
 * The volt rule under the title is the brand's load-bearing accent: a short
 * filled bar rather than volt text, which would fail contrast on a light
 * surface.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between',
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-bold tracking-tight text-foreground">
          {title}
        </h1>
        <span aria-hidden className="mt-2 block h-1 w-10 rounded-full bg-primary" />
        {description ? (
          <p className="mt-3 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>
      ) : null}
    </div>
  )
}

/** Section heading for card groups within a page. */
export function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  )
}
