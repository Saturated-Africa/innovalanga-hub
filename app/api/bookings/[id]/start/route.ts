import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'mentor'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const booking = await prisma.booking.findUnique({ where: { id: params.id } })
  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (booking.status !== 'Confirmed') {
    return NextResponse.json({ error: 'Booking is not in Confirmed state' }, { status: 409 })
  }

  const updated = await prisma.booking.update({
    where: { id: params.id },
    data: { status: 'InProgress', actualStart: new Date() },
  })

  return NextResponse.json(updated)
}
