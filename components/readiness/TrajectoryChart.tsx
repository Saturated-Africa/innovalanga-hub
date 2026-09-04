'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { useChartColors, tooltipStyle } from './useChartColors'

interface DataPoint {
  period: string
  TRL: number
  BRL: number
  IRL: number
}

interface TrajectoryChartProps {
  data: DataPoint[]
}

const PERIOD_LABELS: Record<string, string> = {
  baseline: 'Baseline',
  month_3: 'Month 3',
  month_6: 'Month 6',
  month_9: 'Month 9',
  final: 'Final',
}

export function TrajectoryChart({ data }: TrajectoryChartProps) {
  const c = useChartColors()
  const chartData = data.map((d) => ({ ...d, period: PERIOD_LABELS[d.period] ?? d.period }))

  const series = [
    { key: 'TRL', color: c.trl },
    { key: 'BRL', color: c.brl },
    { key: 'IRL', color: c.irl },
  ]

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
        <XAxis
          dataKey="period"
          tick={{ fontSize: 12, fill: c.axis }}
          tickLine={false}
          axisLine={{ stroke: c.grid }}
        />
        <YAxis
          domain={[0, 9]}
          ticks={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]}
          tick={{ fontSize: 12, fill: c.axis }}
          tickLine={false}
          axisLine={false}
          width={28}
        />
        <Tooltip {...tooltipStyle(c)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            stroke={s.color}
            strokeWidth={2}
            dot={{ r: 3.5, strokeWidth: 0, fill: s.color }}
            activeDot={{ r: 5.5, strokeWidth: 0 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
