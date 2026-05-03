'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Props {
  data: { name: string; TRL: number; BRL: number; IRL: number }[]
}

export function CohortProgressChart({ data }: Props) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Average Readiness by Cohort</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis domain={[0, 9]} ticks={[0, 3, 6, 9]} tick={{ fontSize: 12 }} />
            <Tooltip contentStyle={{ fontSize: 12 }} />
            <Legend />
            <Bar dataKey="TRL" fill="#3b82f6" radius={[3, 3, 0, 0]} />
            <Bar dataKey="BRL" fill="#22c55e" radius={[3, 3, 0, 0]} />
            <Bar dataKey="IRL" fill="#a855f7" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
