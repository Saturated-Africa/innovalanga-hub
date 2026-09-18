import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { tenantScope } from '@/lib/tenant-db'
import { canActOnBooking } from '@/lib/authz'

const schema = z.object({
  notes: z.string().optional(),
  outcomes: z.string().optional(),
  nextSteps: z.string().optional(),
})

/**
 * The written record of a mentorship session.
 *
 * Ownership was checked for mentors and nothing was checked for the other role
 * that may edit here, so an administrator on one funder's programme could
 * rewrite the notes and outcomes on another funder's session. Both cases now go
 * through the shared booking predicate, which answers ownership for a mentor
 * and tenancy for an administrator.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { bookingId: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'mentor'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  if (!(await canActOnBooking(session, params.bookingId, programmeId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const log = await prisma.mentorshipLog.findUnique({
    where: { bookingId: params.bookingId },
    select: { bookingId: true },
  })
  if (!log) return NextResponse.json({ error: 'Log not found' }, { status: 404 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const updated = await prisma.mentorshipLog.update({
    where: { bookingId: params.bookingId },
    data: parsed.data,
  })

  return NextResponse.json(updated)
}
