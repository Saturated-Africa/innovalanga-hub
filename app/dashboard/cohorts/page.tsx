import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/utils'
import { Users, Calendar, MapPin } from 'lucide-react'

export default async function CohortsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!['super_admin', 'facilitator'].includes(session.user.role)) redirect('/dashboard')

  const cohorts = await prisma.cohort.findMany({
    include: {
      region: { select: { name: true } },
      _count: { select: { innovators: true } },
      innovators: {
        include: {
          assessments: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      },
    },
    orderBy: { startDate: 'desc' },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cohorts</h1>
        <p className="text-muted-foreground mt-1">{cohorts.length} cohort{cohorts.length !== 1 ? 's' : ''}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {cohorts.map((c) => {
          const latestAssessments = c.innovators
            .map((i) => i.assessments[0])
            .filter(Boolean)

          const avgTRL = latestAssessments.length > 0
            ? (latestAssessments.reduce((s, a) => s + a!.trlScore, 0) / latestAssessments.length).toFixed(1)
            : '—'
          const avgBRL = latestAssessments.length > 0
            ? (latestAssessments.reduce((s, a) => s + a!.brlScore, 0) / latestAssessments.length).toFixed(1)
            : '—'
          const avgIRL = latestAssessments.length > 0
            ? (latestAssessments.reduce((s, a) => s + a!.irlScore, 0) / latestAssessments.length).toFixed(1)
            : '—'

          return (
            <Card key={c.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{c.name}</CardTitle>
                    <CardDescription className="mt-1 flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {c.region?.name ?? 'No region'}
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="shrink-0">Active</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {c.description && (
                  <p className="text-sm text-muted-foreground">{c.description}</p>
                )}

                <div className="flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Users className="h-4 w-4" />
                    {c._count.innovators} innovators
                  </span>
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    {formatDate(c.startDate)} – {formatDate(c.endDate)}
                  </span>
                </div>

                {/* Average scores */}
                <div className="grid grid-cols-3 gap-2 pt-2 border-t">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground font-medium">Avg TRL</p>
                    <p className="text-xl font-bold text-blue-600">{avgTRL}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground font-medium">Avg BRL</p>
                    <p className="text-xl font-bold text-green-600">{avgBRL}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground font-medium">Avg IRL</p>
                    <p className="text-xl font-bold text-purple-600">{avgIRL}</p>
                  </div>
                </div>

                <Button variant="outline" size="sm" className="w-full" asChild>
                  <Link href={`/dashboard/cohorts/${c.id}`}>View Cohort</Link>
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
