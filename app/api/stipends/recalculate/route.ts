import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  stipendRecordId: z.string().min(1),
})

/**
 * POST /api/stipends/recalculate
 * Recalculates hoursCompleted for a StipendRecord from actual completed booking durations
 * and updates eligibility status based on the result.
 */
export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const record = await prisma.stipendRecord.findUnique({
    where: { id: parsed.data.stipendRecordId },
  })
  if (!record) return NextResponse.json({ error: 'Stipend record not found' }, { status: 404 })

  // Sum actualDurationMinutes for Completed bookings within the period
  const bookings = await prisma.booking.findMany({
    where: {
      innovatorId: record.innovatorId,
      status: 'Completed',
      scheduledStart: {
        gte: record.periodStart,
        lte: record.periodEnd,
      },
      actualDurationMinutes: { not: null },
    },
    select: { actualDurationMinutes: true },
  })

  const totalMinutes = bookings.reduce((sum, b) => sum + (b.actualDurationMinutes ?? 0), 0)
  const hoursCompleted = Math.round((totalMinutes / 60) * 10) / 10

  // Eligibility: >= 1 completed session in the period = Eligible
  // Keep Override status unchanged; only auto-update Pending/Eligible/NotEligible
  const newStatus =
    record.status === 'Override'
      ? 'Override'
      : hoursCompleted > 0
      ? 'Eligible'
      : 'NotEligible'

  const updated = await prisma.stipendRecord.update({
    where: { id: record.id },
    data: {
      hoursCompleted,
      status: newStatus,
    },
    include: {
      innovator: { select: { firstName: true, lastName: true } },
    },
  })

  return NextResponse.json(updated)
}
