'use client'

import { useEffect, useState } from 'react'
import { READINESS, type ReadinessKey } from '@/lib/readiness-colors'

export interface ChartPalette {
  trl: string
  brl: string
  irl: string
  mrl: string
  neutral: string
  grid: string
  axis: string
}

/** Light-theme values, used for the server render and the first client paint. */
const FALLBACK: ChartPalette = {
  trl: READINESS.trl.fallback,
  brl: READINESS.brl.fallback,
  irl: READINESS.irl.fallback,
  mrl: READINESS.mrl.fallback,
  neutral: '#3A3739',
  grid: '#E4E3DF',
  axis: '#6B6866',
}

function readVar(name: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return raw ? `hsl(${raw})` : fallback
}

/**
 * Resolve the chart ramp from the live CSS variables.
 *
 * Recharts needs concrete colour strings, not Tailwind classes, so the tokens
 * have to be read off the document. That can only happen in the browser — and
 * doing it during render would make the server and client markup disagree, so
 * the first paint uses the light-theme fallbacks and the real values land in an
 * effect. Re-reads when the `dark` class is toggled on <html>.
 */
export function useChartColors(): ChartPalette {
  const [palette, setPalette] = useState<ChartPalette>(FALLBACK)

  useEffect(() => {
    const resolve = () =>
      setPalette({
        trl: readVar('--chart-1', FALLBACK.trl),
        brl: readVar('--chart-2', FALLBACK.brl),
        irl: readVar('--chart-3', FALLBACK.irl),
        mrl: readVar('--chart-4', FALLBACK.mrl),
        neutral: readVar('--chart-5', FALLBACK.neutral),
        grid: readVar('--chart-grid', FALLBACK.grid),
        axis: readVar('--muted-foreground', FALLBACK.axis),
      })

    resolve()

    const observer = new MutationObserver(resolve)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
    return () => observer.disconnect()
  }, [])

  return palette
}

/** Shared Recharts tooltip chrome, so tooltips stop inheriting default styling. */
export function tooltipStyle(palette: ChartPalette) {
  return {
    contentStyle: {
      fontSize: 12,
      borderRadius: 6,
      border: `1px solid ${palette.grid}`,
      backgroundColor: 'hsl(var(--popover))',
      color: 'hsl(var(--popover-foreground))',
      boxShadow: '0 6px 16px -4px rgb(31 29 30 / 0.12)',
    },
    labelStyle: { fontWeight: 600, marginBottom: 2 },
    cursor: { fill: palette.grid, fillOpacity: 0.35 },
  }
}

export function colorFor(palette: ChartPalette, key: ReadinessKey): string {
  return palette[key]
}
