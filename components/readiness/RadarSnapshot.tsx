'use client'

import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from 'recharts'

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
  const data = [
    {
      metric: 'TRL',
      score: trl,
      cohort: cohortAvgTRL,
    },
    {
      metric: 'BRL',
      score: brl,
      cohort: cohortAvgBRL,
    },
    {
      metric: 'IRL',
      score: irl,
      cohort: cohortAvgIRL,
    },
  ]

  const showCohort = cohortAvgTRL !== undefined

  return (
    <ResponsiveContainer width="100%" height={260}>
      <RadarChart data={data} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
        <PolarGrid />
        <PolarAngleAxis dataKey="metric" tick={{ fontSize: 13, fontWeight: 600 }} />
        <Tooltip
          formatter={(value: number) => [value, '']}
          contentStyle={{ fontSize: 12 }}
        />
        <Radar
          name="Score"
          dataKey="score"
          stroke="#3b82f6"
          fill="#3b82f6"
          fillOpacity={0.3}
          dot={{ r: 4, fill: '#3b82f6' }}
        />
        {showCohort && (
          <Radar
            name="Cohort Avg"
            dataKey="cohort"
            stroke="#94a3b8"
            fill="#94a3b8"
            fillOpacity={0.15}
            strokeDasharray="4 2"
          />
        )}
        {showCohort && <Legend />}
      </RadarChart>
    </ResponsiveContainer>
  )
}
