import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { canActOnBooking } from '@/lib/authz'
import { resolveProgrammeId } from '@/lib/scope'

const schema = z.object({
  cancelledBy: z.enum(['innovator', 'mentor', 'admin']),
  cancelReason: z.string().optional(),
})

interface Params { params: { id: string } }

export async function PATCH(req: Request, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const booking = await prisma.booking.findUnique({
    where: { id: params.id },
    include: {
      innovator: { include: { user: { select: { id: true, email: true } } } },
      mentor: { include: { user: { select: { id: true, email: true } } } },
    },
  })
  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!['Confirmed', 'InProgress'].includes(booking.status)) {
    return NextResponse.json({ error: 'Only confirmed or in-progress bookings can be cancelled.' }, { status: 422 })
  }

  // Only the innovator, that mentor, or an admin can cancel
  const isInnovator = session.user.id === booking.innovator.user.id
  const isMentor = session.user.id === booking.mentor.user.id
  // A facilitator on one programme could cancel another funder's sessions:
  // the role was checked, the programme was not.
  const programmeId = await resolveProgrammeId(session)
  const isAdmin =
    ['super_admin', 'facilitator'].includes(session.user.role) &&
    (await canActOnBooking(session, params.id, programmeId))
  if (!isInnovator && !isMentor && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Innovators can only cancel up to 2h before the session
  if (isInnovator) {
    const twoHoursBefore = new Date(booking.scheduledStart.getTime() - 2 * 60 * 60 * 1000)
    if (new Date() > twoHoursBefore) {
      return NextResponse.json(
        { error: 'Cancellations must be made at least 2 hours before the session.' },
        { status: 422 }
      )
    }
  }

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const updated = await prisma.booking.update({
    where: { id: params.id },
    data: {
      status: 'Cancelled',
      cancelledBy: parsed.data.cancelledBy,
      cancelReason: parsed.data.cancelReason || null,
    },
  })

  return NextResponse.json(updated)
}
