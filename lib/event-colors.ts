/**
 * Session-type swatches.
 *
 * `EventType.color` is persisted hex, rendered through inline styles, so
 * rebranding it is a data change rather than a CSS change. The palette lives
 * here so the picker, the API validator and the seed all read the same list —
 * previously the same generic `#0ea5e9`-led set was written out in all three.
 *
 * Every value is dark enough to carry white text (>= 4.6:1) and to stay visible
 * as a small dot on the light canvas.
 */
export const EVENT_COLORS = [
  '#6E7C00', // volt deep — the brand swatch, and the default
  '#0E7490', // cyan
  '#9A3412', // burnt orange
  '#5B21B6', // violet
  '#0F766E', // teal
  '#A16207', // amber deep
  '#3A3739', // brand grey
] as const

export const DEFAULT_EVENT_COLOR = EVENT_COLORS[0]

/** Legacy swatches to migrate, mapped onto their nearest brand replacement. */
export const LEGACY_EVENT_COLOR_MAP: Record<string, string> = {
  '#0ea5e9': '#0E7490',
  '#8b5cf6': '#5B21B6',
  '#10b981': '#0F766E',
  '#f59e0b': '#A16207',
  '#ef4444': '#9A3412',
  '#ec4899': '#5B21B6',
  '#6366f1': '#0E7490',
}
