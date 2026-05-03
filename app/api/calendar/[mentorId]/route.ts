import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildICalFeed } from '@/lib/ical'

interface Params { params: { mentorId: string } }

// GET /api/calendar/[mentorId]?token=xxx  — iCal feed (unauthenticated, protected by token)
export async function GET(req: Request, { params }: Params) {
  const { searchParams } = new URL(req.url)
  const token = searchParams.get('token')

  const mentor = await prisma.mentorProfile.findFirst({
    where: { id: params.mentorId },
  })
  if (!mentor) return new NextResponse('Not found', { status: 404 })
  if (mentor.icsToken !== token) return new NextResponse('Forbidden', { status: 403 })

  const bookings = await prisma.booking.findMany({
    where: {
      mentorId: params.mentorId,
      status: { in: ['Confirmed', 'InProgress', 'Completed', 'Rescheduled'] },
    },
    include: {
      innovator: true,
      eventType: true,
    },
    orderBy: { scheduledStart: 'desc' },
  })

  const events = bookings.map((b) => ({
    uid: `booking-${b.id}@innovalanga.hub`,
    summary: `Session — ${b.innovator.firstName} ${b.innovator.lastName}`,
    description: [
      b.eventType ? `Type: ${b.eventType.name}` : '',
      b.notes ? `Notes: ${b.notes}` : '',
      b.meetingLink ? `Meeting: ${b.meetingLink}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    location: b.meetingLink || undefined,
    start: b.scheduledStart,
    end: b.scheduledEnd,
    createdAt: b.createdAt,
    status: (b.status === 'Cancelled' || b.status === 'Rescheduled'
      ? 'CANCELLED'
      : 'CONFIRMED') as 'CONFIRMED' | 'CANCELLED',
  }))

  const feed = buildICalFeed(`${mentor.firstName} ${mentor.lastName} — Innovalanga Sessions`, events)

  return new NextResponse(feed, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="innovalanga-${mentor.firstName.toLowerCase()}.ics"`,
      'Cache-Control': 'no-cache, no-store',
    },
  })
}
