import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { resolveProgrammeId, assertProgrammeInScope } from '@/lib/scope'
import { tenantScope, tenantScopeFor } from '@/lib/tenant-db'

const IndicatorSchema = z.object({
  programmeId: z.string().min(1),
  cohortId: z.string().optional().nullable(),
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['Output', 'Outcome', 'Impact', 'Process']),
  unit: z.string().min(1),
  baseline: z.number().optional().nullable(),
  target: z.number(),
  frequency: z.enum(['Monthly', 'Quarterly', 'SemiAnnual', 'Annual']),
  active: z.boolean().optional(),
})

export async function GET(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator', 'funder_viewer'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Programme comes from the session, never from the query string. Trusting
  // the parameter here let any authenticated facilitator or funder read another
  // programme's data by editing the URL.
  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'No programme found' }, { status: 404 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  const indicators = await prisma.indicator.findMany({
    where: { programmeId },
    include: {
      cohort: { select: { name: true } },
      _count: { select: { records: true } },
      records: { orderBy: { periodStart: 'desc' }, take: 1 },
    },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  })
  return NextResponse.json(indicators)
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = IndicatorSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // The client supplies programmeId in the body; validate it against the
  // session rather than trusting it, otherwise this is a cross-programme write.
  const programmeId = await assertProgrammeInScope(session, parsed.data.programmeId)
  if (!programmeId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // A connection for the programme that was approved, not the caller's default.
  const prisma = await tenantScopeFor(programmeId)

  const indicator = await prisma.indicator.create({
    data: { ...parsed.data, programmeId },
  })
  return NextResponse.json(indicator, { status: 201 })
}
