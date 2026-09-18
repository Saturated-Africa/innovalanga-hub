import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

/** A URL that is definitely safe to render as a link. */
const httpUrl = z
  .string()
  .url()
  .refine(
    (value) => {
      try {
        const scheme = new URL(value).protocol
        return scheme === 'https:' || scheme === 'http:'
      } catch {
        return false
      }
    },
    { message: 'Link must start with http:// or https://' }
  )
import { resolveProgrammeId } from '@/lib/scope'
import { innovatorInProgramme, mentorInProgramme, callerMentorId } from '@/lib/authz'
import { sendBookingConfirmation } from '@/lib/email'
import { notifyBookingConfirmed } from '@/lib/notifications'
import { formatDateTime } from '@/lib/utils'

const schema = z.object({
  mentorId: z.string().min(1),
  innovatorId: z.string().min(1),
  eventTypeId: z.string().optional(),
  scheduledStart: z.string().datetime(),
  scheduledEnd: z.string().datetime(),
  notes: z.string().optional(),
  // `z.string().url()` accepts any scheme the WHATWG parser recognises,
  // including `javascript:` and `data:`. This link is rendered as an anchor on
  // the innovator's and mentor's session pages and written into calendar
  // invites, so an unrestricted scheme here is stored XSS.
  meetingLink: httpUrl.optional().or(z.literal('')),
})

/** Roles that may book a session at all. A funder viewer is not one of them. */
const MAY_BOOK = ['super_admin', 'facilitator', 'mentor', 'innovator']

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!MAY_BOOK.includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const { mentorId, innovatorId, eventTypeId, scheduledStart, scheduledEnd, notes, meetingLink } = parsed.data

  /* Three separate questions, and the route previously asked only the first.
     An innovator may book only for themselves; a mentor may book only into
     their own calendar; and whoever is booking, both people have to be inside
     the caller's programme. Without the last of those, any signed-in account
     could put a session in a mentor's diary on another funder's programme, with
     a meeting link and notes attached. */
  if (session.user.role === 'innovator') {
    const profile = await prisma.innovatorProfile.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    })
    if (!profile || profile.id !== innovatorId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  if (session.user.role === 'mentor' && (await callerMentorId(session)) !== mentorId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const programmeId = await resolveProgrammeId(session)
  const [innovatorOk, mentorOk] = await Promise.all([
    innovatorInProgramme(innovatorId, programmeId),
    mentorInProgramme(mentorId, programmeId),
  ])
  if (!innovatorOk || !mentorOk) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const booking = await prisma.$transaction(async (tx) => {
      const existingActive = await tx.booking.findFirst({
        where: { innovatorId, status: { in: ['Confirmed', 'InProgress'] } },
      })
      if (existingActive) {
        throw new Error('You already have an active session booked.')
      }

      const conflict = await tx.booking.findFirst({
        where: {
          mentorId,
          status: { in: ['Confirmed', 'InProgress'] },
          OR: [
            { scheduledStart: { lt: new Date(scheduledEnd), gte: new Date(scheduledStart) } },
            { scheduledEnd: { gt: new Date(scheduledStart), lte: new Date(scheduledEnd) } },
            {
              AND: [
                { scheduledStart: { lte: new Date(scheduledStart) } },
                { scheduledEnd: { gte: new Date(scheduledEnd) } },
              ],
            },
          ],
        },
      })
      if (conflict) {
        throw new Error('This slot was just taken. Please select another time.')
      }

      return tx.booking.create({
        data: {
          mentorId,
          innovatorId,
          eventTypeId: eventTypeId || null,
          scheduledStart: new Date(scheduledStart),
          scheduledEnd: new Date(scheduledEnd),
          notes: notes || null,
          meetingLink: meetingLink || null,
          status: 'Confirmed',
        },
      })
    })

    const [mentorProfile, innovatorProfile] = await Promise.all([
      prisma.mentorProfile.findUnique({
        where: { id: mentorId },
        include: { user: { select: { email: true } } },
      }),
      prisma.innovatorProfile.findUnique({
        where: { id: innovatorId },
        include: { user: { select: { email: true } } },
      }),
    ])

    if (mentorProfile && innovatorProfile) {
      const innovatorName = `${innovatorProfile.firstName} ${innovatorProfile.lastName}`
      const mentorName = `${mentorProfile.firstName} ${mentorProfile.lastName}`

      try {
        await sendBookingConfirmation({
          innovatorEmail: innovatorProfile.user.email,
          innovatorName,
          mentorEmail: mentorProfile.user.email,
          mentorName,
          scheduledStart: new Date(scheduledStart),
          scheduledEnd: new Date(scheduledEnd),
          zoomLink: meetingLink || null,
        })
      } catch {
        // Email failure is non-fatal
      }

      try {
        await notifyBookingConfirmed({
          mentorUserId: mentorProfile.userId,
          innovatorUserId: innovatorProfile.userId,
          mentorName,
          innovatorName,
          bookingId: booking.id,
          dateStr: formatDateTime(new Date(scheduledStart)),
        })
      } catch {
        // Notification failure is non-fatal
      }
    }

    return NextResponse.json(booking, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 409 })
  }
}
