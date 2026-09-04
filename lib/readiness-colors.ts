/**
 * The single source of truth for readiness-dimension colour.
 *
 * Before this module the TRL/BRL/IRL triad (blue / green / purple) was
 * hardcoded independently in eight page files plus four chart components —
 * twelve places that had to be kept in sync by hand, in two different formats
 * (Tailwind classes and raw hex).
 *
 * Charts cannot read Tailwind classes and pages cannot read raw hex, so each
 * dimension carries both, derived from the same `--chart-*` token. The `hsl`
 * values are resolved at call time from the CSS variable so the ramp follows
 * the active theme; `fallback` covers server rendering, where no computed
 * style exists yet.
 */

export type ReadinessKey = 'trl' | 'brl' | 'irl' | 'mrl'

export interface ReadinessColor {
  /** Token index in the `--chart-*` ramp. */
  token: 1 | 2 | 3 | 4
  /** Short label, as shown on axes and score cards. */
  label: string
  /** Full name, for tooltips and the assistant. */
  name: string
  /** Text colour class, for scores and inline figures. */
  text: string
  /** Solid fill class, for chips and progress fills. */
  fill: string
  /** Tinted surface + border, for score cards. */
  surface: string
  /** Static hex, for Recharts on the server. */
  fallback: string
}

export const READINESS: Record<ReadinessKey, ReadinessColor> = {
  trl: {
    token: 1,
    label: 'TRL',
    name: 'Technology Readiness Level',
    text: 'text-chart-1',
    fill: 'bg-chart-1',
    surface: 'bg-chart-1/8 border-chart-1/25',
    fallback: '#6E7C00',
  },
  brl: {
    token: 2,
    label: 'BRL',
    name: 'Business Readiness Level',
    text: 'text-chart-2',
    fill: 'bg-chart-2',
    surface: 'bg-chart-2/8 border-chart-2/25',
    fallback: '#0E7490',
  },
  irl: {
    token: 3,
    label: 'IRL',
    name: 'Innovation Readiness Level',
    text: 'text-chart-3',
    fill: 'bg-chart-3',
    surface: 'bg-chart-3/8 border-chart-3/25',
    fallback: '#9A3412',
  },
  mrl: {
    token: 4,
    label: 'MRL',
    name: 'Market Readiness Level',
    text: 'text-chart-4',
    fill: 'bg-chart-4',
    surface: 'bg-chart-4/8 border-chart-4/25',
    fallback: '#5B21B6',
  },
}

/** Display order, matching the assessment form and every chart legend. */
export const READINESS_ORDER: ReadinessKey[] = ['trl', 'brl', 'irl', 'mrl']

/**
 * Resolve a chart token to a concrete colour.
 *
 * Recharts needs a colour string, not a class. In the browser we read the live
 * CSS variable so the series follow the active theme; on the server (and
 * before hydration) we fall back to the light-theme hex.
 */
export function chartColor(token: number, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(`--chart-${token}`)
    .trim()
  return raw ? `hsl(${raw})` : fallback
}

/** Convenience: the resolved colour for a readiness dimension. */
export function readinessColor(key: ReadinessKey): string {
  const dim = READINESS[key]
  return chartColor(dim.token, dim.fallback)
}

/** The grid/axis colour, so charts stop hardcoding `#f1f5f9`. */
export function chartGridColor(): string {
  if (typeof window === 'undefined') return '#E4E3DF'
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--chart-grid')
    .trim()
  return raw ? `hsl(${raw})` : '#E4E3DF'
}
