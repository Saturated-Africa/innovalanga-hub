import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildSingleICalEvent } from '@/lib/ical'

interface Params { params: { mentorId: string } }

// GET /api/calendar/[mentorId]/download?bookingId=xxx — download single booking as .ics
export async function GET(req: Request, { params }: Params) {
  const { searchParams } = new URL(req.url)
  const bookingId = searchParams.get('bookingId')
  if (!bookingId) return new NextResponse('Missing bookingId', { status: 400 })

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      mentor: true,
      innovator: true,
      eventType: true,
    },
  })
  if (!booking || booking.mentorId !== params.mentorId) {
    return new NextResponse('Not found', { status: 404 })
  }

  const event = {
    uid: `booking-${booking.id}@innovalanga.hub`,
    summary: booking.eventType
      ? `${booking.eventType.name} — ${booking.mentor.firstName} ${booking.mentor.lastName}`
      : `Mentorship Session — ${booking.mentor.firstName} ${booking.mentor.lastName}`,
    description: [
      booking.notes ? `Notes: ${booking.notes}` : '',
      booking.meetingLink ? `Meeting: ${booking.meetingLink}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    location: booking.meetingLink || undefined,
    start: booking.scheduledStart,
    end: booking.scheduledEnd,
    createdAt: booking.createdAt,
    status: 'CONFIRMED' as const,
  }

  const ics = buildSingleICalEvent(event, 'Innovalanga Session')

  return new NextResponse(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="session-${booking.id}.ics"`,
    },
  })
}
