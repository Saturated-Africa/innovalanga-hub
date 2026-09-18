import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { IndicatorType, MeasurementFrequency } from '@prisma/client'
import { tenantScope } from '@/lib/tenant-db'

/**
 * Both handlers previously trusted `params.id` alone: a facilitator on one
 * programme could edit or delete another funder's indicators by id.
 *
 * PATCH also passed the raw request body straight into `data`, which allowed
 * two things Prisma is happy to do and this route never intended: reassigning
 * `programmeId` to move a record between tenants, and nested writes such as
 * `{"records":{"deleteMany":{}}}` to wipe every measurement attached to it.
 *
 * The schema below is an allowlist. `programmeId` is deliberately absent.
 */
const schema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  type: z.nativeEnum(IndicatorType).optional(),
  unit: z.string().min(1).max(40).optional(),
  baseline: z.number().nullable().optional(),
  target: z.number().optional(),
  frequency: z.nativeEnum(MeasurementFrequency).optional(),
  active: z.boolean().optional(),
  cohortId: z.string().nullable().optional(),
})

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'No programme found' }, { status: 404 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })
  }

  // A cohort supplied by the client is checked against the caller's programme
  // rather than trusted.
  if (parsed.data.cohortId) {
    const cohort = await prisma.cohort.findFirst({
      where: { id: parsed.data.cohortId, programmeId },
      select: { id: true },
    })
    if (!cohort) {
      return NextResponse.json({ error: 'Cohort not found in your programme' }, { status: 403 })
    }
  }

  const result = await prisma.indicator.updateMany({
    where: { id: params.id, programmeId },
    data: parsed.data,
  })
  if (result.count === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const indicator = await prisma.indicator.findUnique({ where: { id: params.id } })
  return NextResponse.json(indicator)
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'No programme found' }, { status: 404 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope

  const deleted = await prisma.indicator.deleteMany({
    where: { id: params.id, programmeId },
  })
  if (deleted.count === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
