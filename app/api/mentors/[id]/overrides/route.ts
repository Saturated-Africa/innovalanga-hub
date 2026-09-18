import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { tenantScope } from '@/lib/tenant-db'
import { canManageMentorSchedule, canReadMentorSchedule } from '@/lib/authz'

/**
 * One-off changes to a mentor's normal weekly availability.
 *
 * Same shape, and same history, as the blackout routes beside them: the read
 * required only a session, and neither verb checked which programme the mentor
 * belonged to.
 */
const createSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  available: z.boolean(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
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

  const overrides = await prisma.mentorDateOverride.findMany({
    where: { mentorId: params.id, date: { gte: new Date() } },
    orderBy: { date: 'asc' },
  })
  return NextResponse.json(overrides)
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

  // The mentor comes from the path, written after the parsed body rather than
  // spread with it, so a mentorId in the request cannot reassign the record.
  const override = await prisma.mentorDateOverride.create({
    data: {
      ...parsed.data,
      date: new Date(parsed.data.date),
      mentorId: params.id,
    },
  })
  return NextResponse.json(override, { status: 201 })
}
