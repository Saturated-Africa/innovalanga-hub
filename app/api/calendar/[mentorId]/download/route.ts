import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildSingleICalEvent } from '@/lib/ical'
import { resolveProgrammeId } from '@/lib/scope'

interface Params { params: Promise<{ mentorId: string }> }

/**
 * GET /api/calendar/[mentorId]/download?bookingId=xxx
 *
 * This route had no authentication of any kind. Anyone who could guess or
 * obtain a booking id received the session's private notes and its meeting
 * link, along with both participants' names. Booking ids are cuids, so this was
 * not trivially enumerable, but ids appear in URLs, emails and logs, and the
 * route treated possession of one as authorisation.
 *
 * Note the sibling feed route at /api/calendar/[mentorId] is deliberately
 * different: it authenticates with a per-mentor `icsToken` because calendar
 * clients cannot carry a session cookie. This route is fetched by the browser
 * from a page the user is already signed in to, so it uses the session.
 */
export async function GET(req: Request, props: Params) {
  const params = await props.params;
  const session = await getSession()
  if (!session) return new NextResponse('Unauthorized', { status: 401 })

  const { searchParams } = new URL(req.url)
  const bookingId = searchParams.get('bookingId')
  if (!bookingId) return new NextResponse('Missing bookingId', { status: 400 })

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      mentor: { include: { user: { select: { id: true } } } },
      innovator: { include: { user: { select: { id: true } } }, },
      eventType: true,
    },
  })
  if (!booking || booking.mentorId !== params.mentorId) {
    return new NextResponse('Not found', { status: 404 })
  }

  // Only the two participants, or an admin on the same programme, may download
  // a session. Everyone else gets the same 404 as a non-existent booking, so
  // the response does not confirm that an id is real.
  const isMentor = session.user.id === booking.mentor.user.id
  const isInnovator = session.user.id === booking.innovator.user.id
  let allowed = isMentor || isInnovator

  if (!allowed && ['super_admin', 'facilitator'].includes(session.user.role)) {
    const programmeId = await resolveProgrammeId(session)
    allowed = Boolean(
      programmeId &&
        (await prisma.booking.findFirst({
          where: { id: bookingId, innovator: { cohort: { programmeId } } },
          select: { id: true },
        }))
    )
  }

  if (!allowed) return new NextResponse('Not found', { status: 404 })

  const event = {
    uid: `booking-${booking.id}@innovalanga.hub`,
    summary: booking.eventType
      ? `${booking.eventType.name} - ${booking.mentor.firstName} ${booking.mentor.lastName}`
      : `Mentorship Session - ${booking.mentor.firstName} ${booking.mentor.lastName}`,
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
