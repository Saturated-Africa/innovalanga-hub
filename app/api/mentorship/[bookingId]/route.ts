import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  notes: z.string().optional(),
  outcomes: z.string().optional(),
  nextSteps: z.string().optional(),
})

export async function PATCH(
  req: Request,
  { params }: { params: { bookingId: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'mentor'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const log = await prisma.mentorshipLog.findUnique({
    where: { bookingId: params.bookingId },
    include: { booking: { include: { mentor: true } } },
  })

  if (!log) return NextResponse.json({ error: 'Log not found' }, { status: 404 })

  // Mentors can only edit their own logs
  if (session.user.role === 'mentor' && log.booking.mentor.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const updated = await prisma.mentorshipLog.update({
    where: { bookingId: params.bookingId },
    data: parsed.data,
  })

  return NextResponse.json(updated)
}
