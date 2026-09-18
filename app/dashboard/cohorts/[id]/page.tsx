import { getSession } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RadarSnapshot } from '@/components/readiness/RadarSnapshot'
import { TrajectoryChart } from '@/components/readiness/TrajectoryChart'
import { DataTable } from '@/components/shared/DataTable'
import { formatDate } from '@/lib/utils'
import { ArrowLeft } from 'lucide-react'
import { CohortInnovatorsTable } from './CohortInnovatorsTable'

interface Props {
  params: Promise<{ id: string }>
}

export default async function CohortDetailPage(props: Props) {
  const params = await props.params;
  const session = await getSession()
  if (!session) redirect('/login')
  if (!['super_admin', 'facilitator'].includes(session.user.role)) redirect('/dashboard')

  const cohort = await prisma.cohort.findUnique({
    where: { id: params.id },
    include: {
      region: { select: { name: true } },
      innovators: {
        include: {
          user: { select: { email: true } },
          assessments: { orderBy: { createdAt: 'asc' } },
          _count: { select: { bookings: true } },
        },
      },
    },
  })

  if (!cohort) notFound()

  const latestByInnovator = cohort.innovators.map((i) => ({
    innovator: i,
    latest: i.assessments[i.assessments.length - 1],
  }))

  const withLatest = latestByInnovator.filter((x) => x.latest)
  const avgTRL = withLatest.length > 0
    ? withLatest.reduce((s, x) => s + x.latest!.trlScore, 0) / withLatest.length
    : 0
  const avgBRL = withLatest.length > 0
    ? withLatest.reduce((s, x) => s + x.latest!.brlScore, 0) / withLatest.length
    : 0
  const avgIRL = withLatest.length > 0
    ? withLatest.reduce((s, x) => s + x.latest!.irlScore, 0) / withLatest.length
    : 0

  // Trajectory: average scores per period across cohort
  const PERIODS = ['baseline', 'month_3', 'month_6', 'month_9', 'final']
  const trajectoryData = PERIODS.map((p) => {
    const periodAssessments = cohort.innovators.flatMap((i) =>
      i.assessments.filter((a) => a.period === p)
    )
    if (periodAssessments.length === 0) return null
    return {
      period: p,
      TRL: Math.round(periodAssessments.reduce((s, a) => s + a.trlScore, 0) / periodAssessments.length * 10) / 10,
      BRL: Math.round(periodAssessments.reduce((s, a) => s + a.brlScore, 0) / periodAssessments.length * 10) / 10,
      IRL: Math.round(periodAssessments.reduce((s, a) => s + a.irlScore, 0) / periodAssessments.length * 10) / 10,
    }
  }).filter(Boolean) as { period: string; TRL: number; BRL: number; IRL: number }[]

  const rows = cohort.innovators.map((i) => {
    const latest = i.assessments[i.assessments.length - 1]
    return {
      id: i.id,
      name: `${i.firstName} ${i.lastName}`,
      email: i.user.email,
      business: i.businessName ?? '—',
      trl: latest?.trlScore ?? '—',
      brl: latest?.brlScore ?? '—',
      irl: latest?.irlScore ?? '—',
      assessments: i.assessments.length,
      sessions: i._count.bookings,
    }
  })

  type Row = typeof rows[0]

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/cohorts"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{cohort.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            {cohort.region && <Badge variant="outline">{cohort.region.name}</Badge>}
            <span className="text-sm text-muted-foreground">
              {formatDate(cohort.startDate)} – {formatDate(cohort.endDate)}
            </span>
          </div>
        </div>
      </div>

      {/* Group average score cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Avg TRL', value: avgTRL.toFixed(1), color: 'text-chart-1' },
          { label: 'Avg BRL', value: avgBRL.toFixed(1), color: 'text-chart-2' },
          { label: 'Avg IRL', value: avgIRL.toFixed(1), color: 'text-chart-3' },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-6 text-center">
              <p className="text-sm text-muted-foreground">{s.label}</p>
              <p className={`text-4xl font-bold mt-1 ${s.color}`}>{withLatest.length > 0 ? s.value : '—'}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Cohort Radar (Latest Avg)</CardTitle></CardHeader>
          <CardContent>
            {withLatest.length > 0 ? (
              <RadarSnapshot trl={avgTRL} brl={avgBRL} irl={avgIRL} />
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No assessments yet.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Cohort Trajectory</CardTitle></CardHeader>
          <CardContent>
            {trajectoryData.length > 0 ? (
              <TrajectoryChart data={trajectoryData} />
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No assessment data yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Innovators ({cohort.innovators.length})</CardTitle></CardHeader>
        <CardContent>
          <CohortInnovatorsTable rows={rows} />
        </CardContent>
      </Card>
    </div>
  )
}
