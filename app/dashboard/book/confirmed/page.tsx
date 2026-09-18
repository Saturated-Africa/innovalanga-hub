import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { CheckCircle2, Calendar, Clock, Download } from 'lucide-react'
import { format } from 'date-fns'

interface Props {
  searchParams: Promise<{ bookingId?: string }>
}

function toSAST(d: Date): Date {
  return new Date(d.getTime() + 2 * 60 * 60 * 1000)
}

export default async function BookingConfirmedPage(props: Props) {
  const searchParams = await props.searchParams;
  const session = await getSession()
  if (!session) redirect('/login')

  const { bookingId } = searchParams
  if (!bookingId) redirect('/dashboard/book')

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      mentor: true,
      innovator: true,
      eventType: true,
    },
  })
  if (!booking) redirect('/dashboard/book')

  const startSAST = toSAST(booking.scheduledStart)
  const endSAST = toSAST(booking.scheduledEnd)

  const icalDownloadUrl = `/api/calendar/${booking.mentorId}/download?bookingId=${bookingId}`

  return (
    <div className="max-w-lg mx-auto space-y-6 py-8">
      <div className="flex flex-col items-center text-center space-y-3">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/12">
          <CheckCircle2 className="h-8 w-8 text-success" />
        </div>
        <h1 className="text-2xl font-bold">You&apos;re booked!</h1>
        <p className="text-muted-foreground text-sm">
          Your session with {booking.mentor.firstName} {booking.mentor.lastName} has been confirmed.
          A confirmation email has been sent.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-5 space-y-3 text-sm">
        {booking.eventType && (
          <div className="flex items-center gap-3">
            <span
              className="h-4 w-1 rounded-full shrink-0"
              style={{ backgroundColor: booking.eventType.color }}
            />
            <span className="font-medium">{booking.eventType.name}</span>
          </div>
        )}
        <div className="flex items-center gap-3 text-muted-foreground">
          <Calendar className="h-4 w-4 shrink-0" />
          <span>{format(startSAST, 'EEEE, d MMMM yyyy')}</span>
        </div>
        <div className="flex items-center gap-3 text-muted-foreground">
          <Clock className="h-4 w-4 shrink-0" />
          <span>
            {format(startSAST, 'HH:mm')} – {format(endSAST, 'HH:mm')} SAST
          </span>
        </div>
        {booking.meetingLink && (
          <div className="pt-1">
            <a
              href={booking.meetingLink}
              target="_blank"
              rel="noopener noreferrer"
              className="link-brand text-xs"
            >
              {booking.meetingLink}
            </a>
          </div>
        )}
      </div>

      {/* Add to Calendar (iCal download) */}
      <div className="rounded-lg border bg-muted/40 p-4 space-y-2">
        <p className="text-sm font-medium">Add to your calendar</p>
        <p className="text-xs text-muted-foreground">
          Download the .ics file to add this session to Google Calendar, Outlook, or Apple Calendar.
        </p>
        <Button asChild variant="outline" size="sm" className="gap-2">
          <Link href={icalDownloadUrl}>
            <Download className="h-3.5 w-3.5" />
            Download .ics
          </Link>
        </Button>
      </div>

      <div className="flex gap-3">
        <Button asChild className="flex-1">
          <Link href="/dashboard/innovator/sessions">View My Sessions</Link>
        </Button>
        <Button asChild variant="outline" className="flex-1">
          <Link href="/dashboard/book">Book Another</Link>
        </Button>
      </div>
    </div>
  )
}
