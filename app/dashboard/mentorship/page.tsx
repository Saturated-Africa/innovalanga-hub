import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDateTime, formatDuration } from '@/lib/utils'
import { MentorshipLogEditor } from '@/components/dashboard/MentorshipLogEditor'

export default async function MentorshipPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!['super_admin', 'facilitator', 'mentor'].includes(session.user.role)) redirect('/dashboard')

  const isMentor = session.user.role === 'mentor'

  const whereClause = isMentor
    ? { booking: { mentor: { userId: session.user.id }, status: 'Completed' as const } }
    : { booking: { status: 'Completed' as const } }

  const logs = await prisma.mentorshipLog.findMany({
    where: whereClause,
    include: {
      booking: {
        include: {
          innovator: { select: { firstName: true, lastName: true, businessName: true } },
          mentor: { select: { firstName: true, lastName: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Mentors can edit their own logs; facilitators/admins see read-only
  const canEdit = ['super_admin', 'mentor'].includes(session.user.role)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Mentorship Log</h1>
        <p className="text-muted-foreground mt-1">
          {logs.length} completed session{logs.length !== 1 ? 's' : ''} logged
        </p>
      </div>

      {logs.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No mentorship sessions logged yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {logs.map((log) => {
            const b = log.booking
            return (
              <Card key={log.id}>
                <CardContent className="pt-5">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="font-semibold">
                        {b.innovator.firstName} {b.innovator.lastName}
                        {b.innovator.businessName && (
                          <span className="font-normal text-muted-foreground"> — {b.innovator.businessName}</span>
                        )}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        with {b.mentor.firstName} {b.mentor.lastName} · {formatDateTime(b.scheduledStart)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="border-green-300 text-green-700 bg-green-50">
                        Completed
                      </Badge>
                      {b.actualDurationMinutes && (
                        <Badge variant="outline">{formatDuration(b.actualDurationMinutes)}</Badge>
                      )}
                    </div>
                  </div>

                  <MentorshipLogEditor
                    bookingId={b.id}
                    initialNotes={log.notes}
                    initialOutcomes={log.outcomes}
                    initialNextSteps={log.nextSteps}
                    readonly={!canEdit}
                  />
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
