'use client'

import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from 'recharts'
import { useChartColors, tooltipStyle } from './useChartColors'

interface RadarSnapshotProps {
  trl: number
  brl: number
  irl: number
  cohortAvgTRL?: number
  cohortAvgBRL?: number
  cohortAvgIRL?: number
}

export function RadarSnapshot({
  trl,
  brl,
  irl,
  cohortAvgTRL,
  cohortAvgBRL,
  cohortAvgIRL,
}: RadarSnapshotProps) {
  const c = useChartColors()

  const data = [
    { metric: 'TRL', score: trl, cohort: cohortAvgTRL },
    { metric: 'BRL', score: brl, cohort: cohortAvgBRL },
    { metric: 'IRL', score: irl, cohort: cohortAvgIRL },
  ]

  const showCohort = cohortAvgTRL !== undefined

  return (
    <ResponsiveContainer width="100%" height={260}>
      <RadarChart data={data} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
        <PolarGrid stroke={c.grid} />
        <PolarAngleAxis
          dataKey="metric"
          tick={{ fontSize: 12, fontWeight: 600, fill: c.axis }}
        />
        <PolarRadiusAxis domain={[0, 9]} tick={false} axisLine={false} />
        <Tooltip formatter={(value: number) => [value, '']} {...tooltipStyle(c)} />
        <Radar
          name="Score"
          dataKey="score"
          stroke={c.trl}
          fill={c.trl}
          fillOpacity={0.28}
          strokeWidth={2}
          dot={{ r: 3.5, fill: c.trl, strokeWidth: 0 }}
        />
        {showCohort && (
          <Radar
            name="Cohort average"
            dataKey="cohort"
            stroke={c.neutral}
            fill={c.neutral}
            fillOpacity={0.1}
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        )}
        {showCohort && <Legend wrapperStyle={{ fontSize: 12 }} />}
      </RadarChart>
    </ResponsiveContainer>
  )
}
