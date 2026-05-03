import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BookingStatusBadge } from '@/components/shared/BookingStatusBadge'
import { SessionTimer } from '@/components/dashboard/SessionTimer'
import { StartSessionButton } from '@/components/dashboard/StartSessionButton'
import { formatDateTime, formatDuration } from '@/lib/utils'
import { BookingStatus } from '@prisma/client'

export default async function SessionsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!['super_admin', 'mentor'].includes(session.user.role)) redirect('/dashboard')

  const mentorProfile = session.user.role === 'mentor'
    ? await prisma.mentorProfile.findUnique({ where: { userId: session.user.id } })
    : null

  const whereBase = mentorProfile ? { mentorId: mentorProfile.id } : {}
  const now = new Date()

  const [upcoming, inProgress, past] = await Promise.all([
    prisma.booking.findMany({
      where: { ...whereBase, status: BookingStatus.Confirmed, scheduledStart: { gte: now } },
      include: {
        innovator: { select: { firstName: true, lastName: true, businessName: true } },
        mentor: { select: { firstName: true, lastName: true } },
      },
      orderBy: { scheduledStart: 'asc' },
    }),
    prisma.booking.findMany({
      where: { ...whereBase, status: BookingStatus.InProgress },
      include: {
        innovator: { select: { firstName: true, lastName: true, businessName: true } },
        mentor: { select: { firstName: true, lastName: true } },
      },
      orderBy: { scheduledStart: 'asc' },
    }),
    prisma.booking.findMany({
      where: {
        ...whereBase,
        status: { in: [BookingStatus.Completed, BookingStatus.Cancelled, BookingStatus.NoShowPendingReview] },
      },
      include: {
        innovator: { select: { firstName: true, lastName: true, businessName: true } },
        mentor: { select: { firstName: true, lastName: true } },
      },
      orderBy: { scheduledStart: 'desc' },
      take: 20,
    }),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Sessions</h1>
        <p className="text-muted-foreground mt-1">Manage and review mentoring sessions</p>
      </div>

      <Tabs defaultValue={inProgress.length > 0 ? 'inprogress' : 'upcoming'}>
        <TabsList>
          <TabsTrigger value="upcoming">
            Upcoming <Badge variant="secondary" className="ml-1">{upcoming.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="inprogress">
            In Progress <Badge variant="secondary" className="ml-1">{inProgress.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="past">Past</TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming" className="mt-4">
          {upcoming.length === 0 ? (
            <EmptyState message="No upcoming sessions." />
          ) : (
            <div className="space-y-3">
              {upcoming.map((b) => (
                <Card key={b.id}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start justify-between gap-4">
                      <SessionInfo booking={b} />
                      <div className="flex items-center gap-2 shrink-0">
                        <BookingStatusBadge status={b.status} />
                        <StartSessionButton bookingId={b.id} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="inprogress" className="mt-4">
          {inProgress.length === 0 ? (
            <EmptyState message="No sessions currently in progress." />
          ) : (
            <div className="space-y-3">
              {inProgress.map((b) => (
                <Card key={b.id} className="border-green-200 bg-green-50/30">
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start justify-between gap-4">
                      <SessionInfo booking={b} />
                      <div className="shrink-0">
                        <SessionTimer
                          bookingId={b.id}
                          actualStart={b.actualStart?.toISOString() ?? b.scheduledStart.toISOString()}
                          scheduledEnd={b.scheduledEnd.toISOString()}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="past" className="mt-4">
          {past.length === 0 ? (
            <EmptyState message="No past sessions." />
          ) : (
            <div className="space-y-3">
              {past.map((b) => (
                <Card key={b.id}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start justify-between gap-4">
                      <SessionInfo booking={b} showDuration />
                      <BookingStatusBadge status={b.status} />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function SessionInfo({
  booking,
  showDuration,
}: {
  booking: any
  showDuration?: boolean
}) {
  return (
    <div>
      <p className="font-semibold">
        {booking.innovator.firstName} {booking.innovator.lastName}
        {booking.innovator.businessName && (
          <span className="font-normal text-muted-foreground"> — {booking.innovator.businessName}</span>
        )}
      </p>
      <p className="text-sm text-muted-foreground">
        with {booking.mentor.firstName} {booking.mentor.lastName}
      </p>
      <p className="text-sm mt-1">{formatDateTime(booking.scheduledStart)}</p>
      {showDuration && booking.actualDurationMinutes && (
        <p className="text-xs text-muted-foreground mt-0.5">
          Duration: {formatDuration(booking.actualDurationMinutes)}
        </p>
      )}
      {booking.notes && (
        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{booking.notes}</p>
      )}
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="py-10 text-center text-muted-foreground text-sm">
        {message}
      </CardContent>
    </Card>
  )
}
