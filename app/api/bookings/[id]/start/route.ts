import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { canActOnBooking } from '@/lib/authz'
import { tenantScope } from '@/lib/tenant-db'

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'mentor'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // The role gate above only proves the caller is *a* mentor, not *the* mentor
  // on this booking. Any mentor could start or complete any other mentor's
  // session; `complete` writes actualDurationMinutes, which is the sole input to
  // stipend hours, so this was a write path into someone else's payment record.
  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  if (!(await canActOnBooking(session, params.id, programmeId))) {
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
