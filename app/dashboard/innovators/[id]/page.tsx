import { getSession } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ReadinessScoreCard } from '@/components/readiness/ReadinessScoreCard'
import { RadarSnapshot } from '@/components/readiness/RadarSnapshot'
import { TrajectoryChart } from '@/components/readiness/TrajectoryChart'
import { AssessmentTimeline } from '@/components/readiness/AssessmentTimeline'
import { BookingStatusBadge } from '@/components/shared/BookingStatusBadge'
import { DocumentVault } from '@/components/shared/DocumentVault'
import { AuditLog } from '@/components/shared/AuditLog'
import { formatDate, formatDateTime } from '@/lib/utils'
import Link from 'next/link'
import { ClipboardList, ArrowLeft, ShieldCheck } from 'lucide-react'
import { REC_CONFIG, STATUS_CONFIG } from '@/lib/ip-engine'
import { IP_RECOMMENDATION_VARIANT } from '@/lib/status-colors'

interface Props {
  params: { id: string }
}

export default async function InnovatorProfilePage({ params }: Props) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!['super_admin', 'facilitator'].includes(session.user.role)) redirect('/dashboard')

  const innovator = await prisma.innovatorProfile.findUnique({
    where: { id: params.id },
    include: {
      user: { select: { email: true } },
      cohort: true,
      region: { select: { name: true } },
      assessments: { orderBy: { createdAt: 'asc' } },
      bookings: {
        include: {
          mentor: { select: { firstName: true, lastName: true } },
          mentorshipLog: true,
        },
        orderBy: { scheduledStart: 'desc' },
        take: 10,
      },
      documents: { orderBy: { uploadedAt: 'desc' } },
      ipAssessment: { select: { primaryRec: true, status: true } },
    },
  })

  if (!innovator) notFound()

  // Cohort average scores for radar
  const cohortInnovators = await prisma.innovatorProfile.findMany({
    where: { cohortId: innovator.cohortId },
    include: {
      assessments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })

  const cohortLatest = cohortInnovators
    .map((i) => i.assessments[0])
    .filter(Boolean)

  const avgTRL = cohortLatest.length > 0
    ? cohortLatest.reduce((s, a) => s + a!.trlScore, 0) / cohortLatest.length
    : undefined
  const avgBRL = cohortLatest.length > 0
    ? cohortLatest.reduce((s, a) => s + a!.brlScore, 0) / cohortLatest.length
    : undefined
  const avgIRL = cohortLatest.length > 0
    ? cohortLatest.reduce((s, a) => s + a!.irlScore, 0) / cohortLatest.length
    : undefined

  const latest = innovator.assessments[innovator.assessments.length - 1]
  const prev = innovator.assessments[innovator.assessments.length - 2]

  const trajectoryData = innovator.assessments.map((a) => ({
    period: a.period,
    TRL: a.trlScore,
    BRL: a.brlScore,
    IRL: a.irlScore,
  }))

  const docTypeLabels: Record<string, string> = {
    id_document: 'ID Document',
    proof_of_address: 'Proof of Address',
    business_plan: 'Business Plan',
    pitch_deck: 'Pitch Deck',
    financial_statement: 'Financial Statement',
    progress_report: 'Progress Report',
    other: 'Other',
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/innovators">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">
            {innovator.firstName} {innovator.lastName}
          </h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {innovator.region && <Badge variant="outline">{innovator.region.name}</Badge>}
            <Badge variant="secondary">{innovator.cohort.name}</Badge>
            {innovator.businessName && (
              <span className="text-sm text-muted-foreground">{innovator.businessName}</span>
            )}
            {innovator.businessSector && (
              <Badge variant="outline" className="text-xs">{innovator.businessSector}</Badge>
            )}
            {innovator.ipAssessment && (
              <Badge variant={IP_RECOMMENDATION_VARIANT[innovator.ipAssessment.primaryRec] ?? 'muted'}>
                <ShieldCheck className="h-3 w-3 mr-1" />
                {REC_CONFIG[innovator.ipAssessment.primaryRec]?.label ?? innovator.ipAssessment.primaryRec}
              </Badge>
            )}
          </div>
        </div>
        <Button asChild>
          <Link href={`/dashboard/assessments/new?innovatorId=${innovator.id}`}>
            <ClipboardList className="mr-2 h-4 w-4" />
            New Assessment
          </Link>
        </Button>
      </div>

      {/* Score Cards */}
      {latest && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <ReadinessScoreCard type="TRL" score={latest.trlScore} previousScore={prev?.trlScore} />
          <ReadinessScoreCard type="BRL" score={latest.brlScore} previousScore={prev?.brlScore} />
          <ReadinessScoreCard type="IRL" score={latest.irlScore} previousScore={prev?.irlScore} />
        </div>
      )}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="assessments">Assessments</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          {session.user.role === 'super_admin' && (
            <TabsTrigger value="audit">Audit Log</TabsTrigger>
          )}
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-6 mt-4">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Readiness Snapshot</CardTitle>
              </CardHeader>
              <CardContent>
                {latest ? (
                  <RadarSnapshot
                    trl={latest.trlScore}
                    brl={latest.brlScore}
                    irl={latest.irlScore}
                    cohortAvgTRL={avgTRL}
                    cohortAvgBRL={avgBRL}
                    cohortAvgIRL={avgIRL}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">No assessments yet.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Score Trajectory</CardTitle>
              </CardHeader>
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
            <CardHeader>
              <CardTitle className="text-base">Profile</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Email</dt>
                  <dd className="font-medium">{innovator.user.email}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Phone</dt>
                  <dd className="font-medium">{innovator.phone ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Business</dt>
                  <dd className="font-medium">{innovator.businessName ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Sector</dt>
                  <dd className="font-medium">{innovator.businessSector ?? '—'}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Bio</dt>
                  <dd className="font-medium">{innovator.bio ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Enrolled</dt>
                  <dd className="font-medium">{formatDate(innovator.createdAt)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Assessments */}
        <TabsContent value="assessments" className="mt-4">
          {innovator.assessments.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                No assessments recorded yet.
              </CardContent>
            </Card>
          ) : (
            <AssessmentTimeline assessments={innovator.assessments} />
          )}
        </TabsContent>

        {/* Sessions */}
        <TabsContent value="sessions" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {innovator.bookings.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground text-sm">No sessions booked.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Mentor</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Duration</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {innovator.bookings.map((b) => (
                      <tr key={b.id} className="hover:bg-muted/20">
                        <td className="px-4 py-3">{formatDateTime(b.scheduledStart)}</td>
                        <td className="px-4 py-3">{b.mentor.firstName} {b.mentor.lastName}</td>
                        <td className="px-4 py-3">
                          {b.actualDurationMinutes ? `${b.actualDurationMinutes} min` : '60 min'}
                        </td>
                        <td className="px-4 py-3">
                          <BookingStatusBadge status={b.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Documents */}
        <TabsContent value="documents" className="mt-4">
          <Card>
            <CardContent className="pt-5">
              <DocumentVault
                innovatorId={innovator.id}
                documents={innovator.documents}
                readonly={session.user.role === 'facilitator' ? false : true}
              />
            </CardContent>
          </Card>
        </TabsContent>
        {/* Audit Log — super_admin only */}
        {session.user.role === 'super_admin' && (
          <TabsContent value="audit" className="mt-4">
            <Card>
              <CardContent className="pt-5">
                <AuditLog innovatorId={innovator.id} />
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
