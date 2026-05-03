import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  scheduledStart: z.string().datetime(),
  scheduledEnd: z.string().datetime(),
  notes: z.string().optional(),
})

interface Params { params: { id: string } }

export async function POST(req: Request, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const original = await prisma.booking.findUnique({
    where: { id: params.id },
    include: {
      innovator: { include: { user: { select: { id: true } } } },
      mentor: { include: { user: { select: { id: true } } } },
    },
  })
  if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (original.status !== 'Confirmed') {
    return NextResponse.json({ error: 'Only confirmed bookings can be rescheduled.' }, { status: 422 })
  }

  const isInnovator = session.user.id === original.innovator.user.id
  const isMentor = session.user.id === original.mentor.user.id
  const isAdmin = ['super_admin', 'facilitator'].includes(session.user.role)
  if (!isInnovator && !isMentor && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Innovators must reschedule at least 24h in advance
  if (isInnovator) {
    const twentyFourHoursBefore = new Date(original.scheduledStart.getTime() - 24 * 60 * 60 * 1000)
    if (new Date() > twentyFourHoursBefore) {
      return NextResponse.json(
        { error: 'Rescheduling must be done at least 24 hours before the session.' },
        { status: 422 }
      )
    }
  }

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const { scheduledStart, scheduledEnd, notes } = parsed.data

  const result = await prisma.$transaction(async (tx) => {
    // Check slot availability for the new time
    const conflict = await tx.booking.findFirst({
      where: {
        mentorId: original.mentorId,
        id: { not: original.id },
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
    if (conflict) throw new Error('The new slot is not available. Please select a different time.')

    // Mark original as rescheduled
    await tx.booking.update({
      where: { id: original.id },
      data: { status: 'Rescheduled' },
    })

    // Create the new booking linked back to the original
    return tx.booking.create({
      data: {
        innovatorId: original.innovatorId,
        mentorId: original.mentorId,
        eventTypeId: original.eventTypeId,
        scheduledStart: new Date(scheduledStart),
        scheduledEnd: new Date(scheduledEnd),
        notes: notes || original.notes,
        meetingLink: original.meetingLink,
        status: 'Confirmed',
        rescheduledFromId: original.id,
      },
    })
  })

  return NextResponse.json(result, { status: 201 })
}
