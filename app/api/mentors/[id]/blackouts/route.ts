import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { tenantScope } from '@/lib/tenant-db'
import { canManageMentorSchedule, canReadMentorSchedule } from '@/lib/authz'

/**
 * Periods a mentor is not available at all.
 *
 * The read used to require nothing but a session. Any account on the platform,
 * including one created through public registration, could list every mentor's
 * blackout periods - and a blackout carries a written reason, which is normally
 * leave, illness or bereavement. Both verbs now go through the shared
 * predicates in lib/authz, which check ownership and tenancy together.
 */
const createSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().max(200).optional(),
})

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  if (!(await canReadMentorSchedule(session, params.id, programmeId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const blackouts = await prisma.blackoutPeriod.findMany({
    where: { mentorId: params.id, endDate: { gte: new Date() } },
    orderBy: { startDate: 'asc' },
  })
  return NextResponse.json(blackouts)
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  if (!(await canManageMentorSchedule(session, params.id, programmeId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  if (new Date(parsed.data.startDate) > new Date(parsed.data.endDate)) {
    return NextResponse.json({ error: 'Start date must be before end date' }, { status: 400 })
  }

  const blackout = await prisma.blackoutPeriod.create({
    data: {
      mentorId: params.id,
      startDate: new Date(parsed.data.startDate),
      endDate: new Date(parsed.data.endDate),
      reason: parsed.data.reason,
    },
  })
  return NextResponse.json(blackout, { status: 201 })
}
