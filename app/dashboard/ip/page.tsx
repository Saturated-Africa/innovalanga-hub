import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { ShieldCheck, ShieldAlert, ShieldOff } from 'lucide-react'
import { REC_CONFIG, STATUS_CONFIG } from '@/lib/ip-engine'
import { IPAdvisorPanel } from './IPAdvisorPanel'

export default async function IPDashboardPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!['super_admin', 'facilitator'].includes(session.user.role)) redirect('/dashboard')

  // Resolve programme
  let programmeId = session.user.programmeId ?? null
  if (!programmeId) {
    const first = await prisma.programme.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, moduleIPEnabled: true } })
    programmeId = first?.id ?? null
    if (!first?.moduleIPEnabled) {
      return (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <p className="text-muted-foreground font-medium">IP Protection module is not enabled for this programme.</p>
          <p className="text-sm text-muted-foreground">Enable it in Admin → Programme Settings.</p>
        </div>
      )
    }
  }

  // All innovators in programme
  const [allInnovators, assessments] = await Promise.all([
    prisma.innovatorProfile.findMany({
      where: { cohort: { programmeId: programmeId ?? undefined } },
      select: { id: true, firstName: true, lastName: true, businessName: true, cohort: { select: { name: true } } },
      orderBy: { lastName: 'asc' },
    }),
    prisma.iPAssessment.findMany({
      where: {
        innovator: { cohort: { programmeId: programmeId ?? undefined } },
      },
      include: {
        innovator: {
          select: { id: true, firstName: true, lastName: true, businessName: true, cohort: { select: { name: true } } },
        },
      },
      orderBy: { completedAt: 'desc' },
    }),
  ])

  const assessedIds = new Set(assessments.map((a) => a.innovatorId))
  const unassessed = allInnovators.filter((i) => !assessedIds.has(i.id))

  const recCounts = assessments.reduce<Record<string, number>>((acc, a) => {
    acc[a.primaryRec] = (acc[a.primaryRec] ?? 0) + 1
    return acc
  }, {})

  const statusCounts = assessments.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">IP Protection</h1>
          <p className="text-muted-foreground mt-1">Intellectual property assessment status across all innovators</p>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Assessed</p>
            <p className="text-3xl font-bold text-green-600 mt-1">{assessments.length}</p>
            <p className="text-xs text-muted-foreground">of {allInnovators.length} innovators</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Not Yet Assessed</p>
            <p className="text-3xl font-bold text-orange-500 mt-1">{unassessed.length}</p>
            <p className="text-xs text-muted-foreground">innovators pending</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Protected</p>
            <p className="text-3xl font-bold text-blue-600 mt-1">{statusCounts['Protected'] ?? 0}</p>
            <p className="text-xs text-muted-foreground">IP applications approved</p>
          </CardContent>
        </Card>
      </div>

      {/* Recommendation distribution */}
      {assessments.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recommendation Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(recCounts).map(([rec, count]) => (
                <div key={rec} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${REC_CONFIG[rec]?.color ?? 'bg-gray-100'}`}>
                  <span className="text-sm font-medium">{REC_CONFIG[rec]?.label ?? rec}</span>
                  <span className="text-sm font-bold">({count})</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Assessments list */}
      {assessments.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Assessed Innovators
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {assessments.map((a) => {
                const recCfg = REC_CONFIG[a.primaryRec]
                const statusCfg = STATUS_CONFIG[a.status]
                return (
                  <IPAdvisorPanel
                    key={a.id}
                    assessment={{
                      innovatorId: a.innovatorId,
                      innovatorName: `${a.innovator.firstName} ${a.innovator.lastName}`,
                      businessName: a.innovator.businessName,
                      cohortName: a.innovator.cohort.name,
                      primaryRec: a.primaryRec,
                      recommendations: a.recommendations as string[],
                      reasoning: a.reasoning,
                      status: a.status,
                      advisorNotes: a.advisorNotes,
                      reviewedBy: a.reviewedBy,
                      completedAt: a.completedAt.toISOString(),
                    }}
                  />
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Not yet assessed */}
      {unassessed.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldOff className="h-4 w-4 text-orange-500" /> Not Yet Assessed ({unassessed.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {unassessed.map((i) => (
                <div key={i.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="text-sm font-medium">{i.firstName} {i.lastName}</p>
                    <p className="text-xs text-muted-foreground">{i.businessName ?? i.cohort.name}</p>
                  </div>
                  <Badge variant="outline" className="text-orange-600 border-orange-200 bg-orange-50">Pending</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {allInnovators.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center py-12 gap-3">
            <ShieldAlert className="h-10 w-10 text-muted-foreground/40" />
            <p className="font-medium text-muted-foreground">No innovators enrolled yet</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
