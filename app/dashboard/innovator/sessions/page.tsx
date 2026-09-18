import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { BookingStatusBadge } from '@/components/shared/BookingStatusBadge'
import { formatDateTime, formatDuration } from '@/lib/utils'
import Link from 'next/link'
import { CalendarPlus } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { CancelBookingButton } from '@/components/dashboard/CancelBookingButton'

export default async function InnovatorSessionsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.user.role !== 'innovator') redirect('/dashboard')

  const profile = await prisma.innovatorProfile.findUnique({
    where: { userId: session.user.id },
  })

  if (!profile) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">My Sessions</h1>
        <p className="text-muted-foreground">Your profile is not set up yet. Contact a facilitator.</p>
      </div>
    )
  }

  const bookings = await prisma.booking.findMany({
    where: { innovatorId: profile.id },
    include: {
      mentor: { select: { firstName: true, lastName: true, expertise: true } },
      mentorshipLog: true,
    },
    orderBy: { scheduledStart: 'desc' },
  })

  const upcoming = bookings.filter((b) => ['Confirmed', 'InProgress'].includes(b.status))
  const past = bookings.filter((b) => ['Completed', 'Cancelled', 'NoShowPendingReview'].includes(b.status))

  const hasActiveBooking = upcoming.some((b) => b.status === 'Confirmed')

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Sessions"
        description="View and manage your mentoring sessions"
        actions={
          <>
        {!hasActiveBooking && (
          <Button asChild>
            <Link href="/dashboard/book">
              <CalendarPlus className="mr-2 h-4 w-4" />
              Book a Session
            </Link>
          </Button>
        )}
          </>
        }
      />

      {upcoming.length > 0 && (
        <div>
          <h2 className="text-base font-semibold mb-3">Upcoming</h2>
          <div className="space-y-3">
            {upcoming.map((b) => (
              <Card key={b.id} className="border-info/25 bg-info/[0.07]">
                <CardContent className="pt-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold">with {b.mentor.firstName} {b.mentor.lastName}</p>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {b.mentor.expertise.slice(0, 2).join(', ')}
                      </p>
                      <p className="text-sm mt-1">{formatDateTime(b.scheduledStart)}</p>
                      {b.meetingLink && (
                        <a href={b.meetingLink} target="_blank" rel="noopener noreferrer" className="link-brand mt-1 block text-sm">
                          Join meeting link
                        </a>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <BookingStatusBadge status={b.status} />
                      {/* Confirmed bookings block re-booking, so the innovator
                          needs a way to release one. In-progress sessions are
                          the mentor's to end, not the innovator's. */}
                      {b.status === 'Confirmed' && (
                        <CancelBookingButton
                          bookingId={b.id}
                          scheduledStart={b.scheduledStart.toISOString()}
                        />
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-base font-semibold mb-3">Past Sessions ({past.length})</h2>
        {past.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground text-sm">
              No past sessions yet.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {past.map((b) => (
              <Card key={b.id}>
                <CardContent className="pt-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold">with {b.mentor.firstName} {b.mentor.lastName}</p>
                      <p className="text-sm text-muted-foreground">{formatDateTime(b.scheduledStart)}</p>
                      {b.actualDurationMinutes && (
                        <p className="text-xs text-muted-foreground">Duration: {formatDuration(b.actualDurationMinutes)}</p>
                      )}
                      {b.mentorshipLog && (
                        <div className="mt-2 text-sm">
                          {b.mentorshipLog.outcomes && (
                            <p><span className="font-medium">Outcomes:</span> {b.mentorshipLog.outcomes}</p>
                          )}
                          {b.mentorshipLog.nextSteps && (
                            <p className="mt-1"><span className="font-medium">Next steps:</span> {b.mentorshipLog.nextSteps}</p>
                          )}
                        </div>
                      )}
                    </div>
                    <BookingStatusBadge status={b.status} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
