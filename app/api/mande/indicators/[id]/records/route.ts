import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { tenantScope } from '@/lib/tenant-db'
import { indicatorInProgramme } from '@/lib/authz'

/**
 * Measurements taken against one indicator.
 *
 * Every verb here had a role gate and no tenancy check, so a facilitator on one
 * funder's programme could read, add to and delete another funder's monitoring
 * data by putting its indicator id in the path.
 *
 * The delete was worse than unscoped. It took the record id from a query string
 * that was never related to the indicator in the path, so any id at all - from
 * any indicator, on any programme - was deleted on request. Both halves are now
 * bound: the indicator must be in the caller's programme, and the record must
 * belong to that indicator.
 */
const RecordSchema = z.object({
  periodLabel: z.string().trim().min(1).max(60),
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  value: z.number().finite(),
  notes: z.string().trim().max(2000).optional(),
})

const READERS = ['super_admin', 'facilitator', 'funder_viewer']
const WRITERS = ['super_admin', 'facilitator']

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!READERS.includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  if (!(await indicatorInProgramme(params.id, programmeId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const records = await prisma.indicatorRecord.findMany({
    where: { indicatorId: params.id },
    orderBy: { periodStart: 'asc' },
  })
  return NextResponse.json(records)
}

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!WRITERS.includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  if (!(await indicatorInProgramme(params.id, programmeId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const parsed = RecordSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  if (new Date(parsed.data.periodEnd) < new Date(parsed.data.periodStart)) {
    return NextResponse.json({ error: 'The period ends before it starts.' }, { status: 400 })
  }

  const record = await prisma.indicatorRecord.create({
    data: {
      indicatorId: params.id,
      periodLabel: parsed.data.periodLabel,
      periodStart: new Date(parsed.data.periodStart),
      periodEnd: new Date(parsed.data.periodEnd),
      value: parsed.data.value,
      notes: parsed.data.notes,
      // Taken from the session, never from the request. Who recorded a figure
      // is part of the evidence trail a funder relies on.
      recordedBy: session.user.name ?? session.user.email ?? 'Unknown',
    },
  })
  return NextResponse.json(record, { status: 201 })
}

export async function DELETE(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!WRITERS.includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const recordId = new URL(req.url).searchParams.get('recordId')
  if (!recordId) return NextResponse.json({ error: 'recordId required' }, { status: 400 })

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  if (!(await indicatorInProgramme(params.id, programmeId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const deleted = await prisma.indicatorRecord.deleteMany({
    where: { id: recordId, indicatorId: params.id },
  })
  if (deleted.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
