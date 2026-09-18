import { cn } from '@/lib/utils'

/**
 * The Innovalanga mark: two offset rounded "data blocks" forming a bolt.
 *
 * Paths lifted verbatim from the official
 * `Innova Logo Exports/SVGs/Colour Logo.svg`, cropped to the mark's own
 * bounding box. These are pure vector paths with no type in them, so unlike
 * the source SVG (whose wordmark is a <text> element set in Gilroy-Black) this
 * renders identically everywhere, with or without the brand font installed.
 *
 * Fill is `currentColor` so the mark inherits from its container — volt on
 * dark surfaces, ink on light ones.
 */
export function InnovalangaMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="160.4 38.4 165.2 322.8"
      fill="currentColor"
      role="img"
      aria-label="Innovalanga"
      className={className}
    >
      <path d="M246.17,205.91h-75.56c-6.27,0-11.08-5.57-10.18-11.77l21.46-146.9c.74-5.05,5.07-8.8,10.18-8.8h75.56c6.27,0,11.08,5.57,10.18,11.77l-21.46,146.9c-.74,5.05-5.07,8.8-10.18,8.8Z" />
      <path d="M293.93,361.23h-75.56c-6.27,0-11.08-5.57-10.18-11.77l21.46-146.9c.74-5.05,5.07-8.8,10.18-8.8h75.56c6.27,0,11.08,5.57,10.18,11.77l-21.46,146.9c-.74,5.05-5.07,8.8-10.18,8.8Z" />
    </svg>
  )
}

/**
 * The wordmark.
 *
 * The brand sets this in Gilroy-Black, which we do not hold a web licence for,
 * so it is set in Figtree at weight 800 with tight negative tracking — the
 * closest free geometric grotesque. Rendering it as live text (rather than
 * shipping the PNG lockup) keeps it crisp at every size, recolourable for the
 * dark shell, and selectable/legible to screen readers.
 *
 * The true Gilroy lockup is available at `/brand/innovalanga-lockup.png` for
 * fixed-size, light-background uses such as exported documents.
 */
export function InnovalangaWordmark({
  className,
  stacked = false,
}: {
  className?: string
  stacked?: boolean
}) {
  if (stacked) {
    return (
      <span
        className={cn(
          'font-sans font-extrabold uppercase leading-[0.86] tracking-[-0.03em]',
          className
        )}
      >
        <span className="block">Innova</span>
        <span className="block">langa</span>
      </span>
    )
  }

  return (
    <span
      className={cn(
        'font-sans font-extrabold uppercase leading-none tracking-[-0.03em]',
        className
      )}
    >
      Innovalanga
    </span>
  )
}

/**
 * Mark + wordmark lockup. `tone` picks the pairing:
 *   - `volt` — volt mark beside light type, for the charcoal shell
 *   - `ink`  — ink mark beside ink type, for light surfaces
 *
 * Note the mark is never rendered volt-on-white: at luminance 0.775 that is a
 * 1.27:1 contrast failure.
 */
export function InnovalangaLogo({
  className,
  markClassName,
  wordClassName,
  tone = 'volt',
  stacked = false,
}: {
  className?: string
  markClassName?: string
  wordClassName?: string
  tone?: 'volt' | 'ink'
  stacked?: boolean
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <InnovalangaMark
        className={cn(
          'h-full w-auto shrink-0',
          tone === 'volt' ? 'text-brand-volt' : 'text-brand-ink',
          markClassName
        )}
      />
      <InnovalangaWordmark
        stacked={stacked}
        className={cn(tone === 'volt' ? 'text-white' : 'text-brand-ink', wordClassName)}
      />
    </span>
  )
}
