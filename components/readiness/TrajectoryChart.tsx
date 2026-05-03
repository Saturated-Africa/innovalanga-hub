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
  const chartData = data.map((d) => ({ ...d, period: PERIOD_LABELS[d.period] ?? d.period }))

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="period" tick={{ fontSize: 12 }} />
        <YAxis domain={[0, 9]} ticks={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]} tick={{ fontSize: 12 }} />
        <Tooltip contentStyle={{ fontSize: 12 }} />
        <Legend />
        <Line
          type="monotone"
          dataKey="TRL"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={{ r: 5 }}
          activeDot={{ r: 7 }}
        />
        <Line
          type="monotone"
          dataKey="BRL"
          stroke="#22c55e"
          strokeWidth={2}
          dot={{ r: 5 }}
          activeDot={{ r: 7 }}
        />
        <Line
          type="monotone"
          dataKey="IRL"
          stroke="#a855f7"
          strokeWidth={2}
          dot={{ r: 5 }}
          activeDot={{ r: 7 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
