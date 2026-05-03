import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
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
  meetingLink: z.string().url().optional().or(z.literal('')),
})

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const { mentorId, innovatorId, eventTypeId, scheduledStart, scheduledEnd, notes, meetingLink } = parsed.data

  if (session.user.role === 'innovator') {
    const profile = await prisma.innovatorProfile.findUnique({ where: { userId: session.user.id } })
    if (!profile || profile.id !== innovatorId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
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
