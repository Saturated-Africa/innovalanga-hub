import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { CohortProgressChart } from './CohortProgressChart'
import { Download } from 'lucide-react'
import { BOOKING_STATUS, statusMeta } from '@/lib/status-colors'
import { PageHeader } from '@/components/shared/PageHeader'

export default async function ReportsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!['super_admin', 'facilitator', 'funder_viewer'].includes(session.user.role)) redirect('/dashboard')

  const [
    totalInnovators,
    totalAssessments,
    completedSessions,
    totalStipendsPaid,
    cohorts,
    assessmentsByPeriod,
    sessionsByStatus,
  ] = await Promise.all([
    prisma.innovatorProfile.count(),
    prisma.assessment.count(),
    prisma.booking.count({ where: { status: 'Completed' } }),
    prisma.stipendRecord.aggregate({
      where: { status: { in: ['Eligible', 'Override'] }, paidAt: { not: null } },
      _sum: { amount: true },
    }),
    prisma.cohort.findMany({
      include: {
        region: { select: { name: true } },
        _count: { select: { innovators: true } },
        innovators: {
          include: { assessments: { orderBy: { createdAt: 'asc' } } },
        },
      },
    }),
    prisma.assessment.groupBy({ by: ['period'], _count: { _all: true } }),
    prisma.booking.groupBy({ by: ['status'], _count: { _all: true } }),
  ])

  const PERIOD_ORDER = ['baseline', 'month_3', 'month_6', 'month_9', 'final']
  const PERIOD_LABELS: Record<string, string> = {
    baseline: 'Baseline',
    month_3: 'Month 3',
    month_6: 'Month 6',
    month_9: 'Month 9',
    final: 'Final',
  }

  const sortedPeriods = assessmentsByPeriod.sort(
    (a, b) => PERIOD_ORDER.indexOf(a.period) - PERIOD_ORDER.indexOf(b.period)
  )

  // Cohort average scores for chart
  const cohortChartData = cohorts.map((c) => {
    const latest = c.innovators.map((i) => i.assessments[i.assessments.length - 1]).filter(Boolean)
    return {
      name: c.name.replace(' Cohort 2024', ''),
      TRL: latest.length > 0 ? Math.round(latest.reduce((s, a) => s + a!.trlScore, 0) / latest.length * 10) / 10 : 0,
      BRL: latest.length > 0 ? Math.round(latest.reduce((s, a) => s + a!.brlScore, 0) / latest.length * 10) / 10 : 0,
      IRL: latest.length > 0 ? Math.round(latest.reduce((s, a) => s + a!.irlScore, 0) / latest.length * 10) / 10 : 0,
    }
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
      <PageHeader title="Programme Reports" description="Programme Performance — Key Indicators" />
        <div className="flex items-center gap-2 flex-wrap">
          {(['innovators', 'assessments', 'sessions', 'stipends'] as const).map((type) => (
            <Button key={type} variant="outline" size="sm" asChild>
              <a href={`/api/reports/export?type=${type}`} download>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </a>
            </Button>
          ))}
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: 'Total Innovators', value: totalInnovators, color: 'text-foreground' },
          { label: 'Assessments Completed', value: totalAssessments, color: 'text-foreground' },
          { label: 'Sessions Completed', value: completedSessions, color: 'text-foreground' },
          {
            label: 'Stipends Disbursed',
            value: formatCurrency(totalStipendsPaid._sum.amount ?? 0),
            color: 'text-warning',
          },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">{kpi.label}</p>
              <p className={`text-3xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Cohorts breakdown */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Cohort Breakdown</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-4">
              {cohorts.map((c) => {
                const latest = c.innovators.map((i) => i.assessments[i.assessments.length - 1]).filter(Boolean)
                const avgTRL = latest.length > 0 ? (latest.reduce((s, a) => s + a!.trlScore, 0) / latest.length).toFixed(1) : '—'
                const avgBRL = latest.length > 0 ? (latest.reduce((s, a) => s + a!.brlScore, 0) / latest.length).toFixed(1) : '—'
                const avgIRL = latest.length > 0 ? (latest.reduce((s, a) => s + a!.irlScore, 0) / latest.length).toFixed(1) : '—'
                return (
                  <div key={c.id} className="border rounded-lg p-3">
                    <div className="flex justify-between mb-2">
                      <span className="font-medium text-sm">{c.name}</span>
                      {c.region && <Badge variant="outline">{c.region.name}</Badge>}
                    </div>
                    <div className="flex gap-4 text-sm">
                      <span>{c._count.innovators} innovators</span>
                      <span className="text-chart-1">TRL: {avgTRL}</span>
                      <span className="text-chart-2">BRL: {avgBRL}</span>
                      <span className="text-chart-3">IRL: {avgIRL}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Assessments by Period</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {sortedPeriods.map((p) => (
                <div key={p.period} className="flex items-center justify-between">
                  <span className="text-sm">{PERIOD_LABELS[p.period] ?? p.period}</span>
                  <div className="flex items-center gap-2">
                    <div className="h-2 rounded-full bg-primary" style={{ width: `${(p._count._all / totalAssessments) * 120}px` }} />
                    <span className="text-sm font-medium w-6 text-right">{p._count._all}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Session statuses */}
      <Card>
        <CardHeader><CardTitle className="text-base">Session Status Summary</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            {sessionsByStatus.map((s) => (
              <div key={s.status} className="flex items-center gap-2">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${
                    statusMeta(BOOKING_STATUS, s.status).dot
                  }`}
                />
                <span className="text-sm">{statusMeta(BOOKING_STATUS, s.status).label}</span>
                <span className="text-sm font-bold">{s._count._all}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <CohortProgressChart data={cohortChartData} />
    </div>
  )
}
