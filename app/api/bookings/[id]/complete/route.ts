import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { canActOnBooking } from '@/lib/authz'
import { tenantScope } from '@/lib/tenant-db'
import { sendSessionCompletedToMentor } from '@/lib/email'
import { notifySessionCompleted } from '@/lib/notifications'

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
  if (booking.status !== 'InProgress') {
    return NextResponse.json({ error: 'Session is not in progress' }, { status: 409 })
  }

  const actualEnd = new Date()
  const actualStart = booking.actualStart ?? booking.scheduledStart
  const durationMs = actualEnd.getTime() - actualStart.getTime()
  const actualDurationMinutes = Math.round(durationMs / 60000)

  const updated = await prisma.booking.update({
    where: { id: params.id },
    data: {
      status: 'Completed',
      actualEnd,
      actualDurationMinutes,
    },
  })

  // Create empty mentorship log for follow-up
  await prisma.mentorshipLog.upsert({
    where: { bookingId: params.id },
    create: { bookingId: params.id },
    update: {},
  })

  // Notify mentor to log session notes (best-effort)
  try {
    const fullBooking = await prisma.booking.findUnique({
      where: { id: params.id },
      include: {
        mentor: { include: { user: { select: { email: true } } } },
        innovator: { select: { firstName: true, lastName: true } },
      },
    })
    if (fullBooking) {
      const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
      const mentorName = `${fullBooking.mentor.firstName} ${fullBooking.mentor.lastName}`
      const innovatorName = `${fullBooking.innovator.firstName} ${fullBooking.innovator.lastName}`
      await sendSessionCompletedToMentor({
        mentorEmail: fullBooking.mentor.user.email,
        mentorName,
        innovatorName,
        scheduledStart: fullBooking.scheduledStart,
        logUrl: `${baseUrl}/dashboard/mentorship`,
      })
      await notifySessionCompleted({
        mentorUserId: fullBooking.mentor.userId,
        innovatorName,
      })
    }
  } catch {
    // Email failure is non-fatal
  }

  return NextResponse.json(updated)
}
