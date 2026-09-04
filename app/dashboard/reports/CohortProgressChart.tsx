'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useChartColors, tooltipStyle } from '@/components/readiness/useChartColors'

interface Props {
  data: { name: string; TRL: number; BRL: number; IRL: number }[]
}

export function CohortProgressChart({ data }: Props) {
  const c = useChartColors()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Average readiness by cohort</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 12, fill: c.axis }}
              tickLine={false}
              axisLine={{ stroke: c.grid }}
            />
            <YAxis
              domain={[0, 9]}
              ticks={[0, 3, 6, 9]}
              tick={{ fontSize: 12, fill: c.axis }}
              tickLine={false}
              axisLine={false}
              width={24}
            />
            <Tooltip {...tooltipStyle(c)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="TRL" fill={c.trl} radius={[2, 2, 0, 0]} maxBarSize={28} />
            <Bar dataKey="BRL" fill={c.brl} radius={[2, 2, 0, 0]} maxBarSize={28} />
            <Bar dataKey="IRL" fill={c.irl} radius={[2, 2, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
