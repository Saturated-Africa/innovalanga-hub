import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { LogFrameLevel } from '@prisma/client'
import { resolveProgrammeId, assertProgrammeInScope } from '@/lib/scope'
import { tenantScope, tenantScopeFor } from '@/lib/tenant-db'

const LEVELS = ['Input', 'Activity', 'Output', 'Outcome', 'Impact'] as const

const ItemSchema = z.object({
  programmeId: z.string().min(1),
  level: z.enum(LEVELS),
  order: z.number().int().optional(),
  description: z.string().min(1),
  indicators: z.string().optional(),
  verificationMeans: z.string().optional(),
  assumptions: z.string().optional(),
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
  const items = await prisma.logFrameItem.findMany({
    where: { programmeId },
    orderBy: [{ level: 'asc' }, { order: 'asc' }],
  })
  return NextResponse.json(items)
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = ItemSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // The client supplies programmeId in the body; validate it against the
  // session rather than trusting it, otherwise this is a cross-programme write.
  const programmeId = await assertProgrammeInScope(session, parsed.data.programmeId)
  if (!programmeId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // A connection for the programme that was approved, not the caller's default.
  const prisma = await tenantScopeFor(programmeId)

  const item = await prisma.logFrameItem.create({
    data: { ...parsed.data, programmeId },
  })
  return NextResponse.json(item, { status: 201 })
}

/**
 * The fields a logframe item exposes for editing.
 *
 * Listed rather than spread. `programmeId` is deliberately absent: an item does
 * not change hands between funders, and allowing it in the body made this route
 * a way to move one there.
 */
const PatchSchema = z.object({
  id: z.string().min(1),
  level: z.nativeEnum(LogFrameLevel).optional(),
  statement: z.string().trim().max(2000).optional(),
  indicator: z.string().trim().max(2000).optional(),
  meansOfVerification: z.string().trim().max(2000).optional(),
  assumptions: z.string().trim().max(2000).optional(),
  sortOrder: z.number().int().optional(),
})

export async function PATCH(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = PatchSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { id, ...data } = parsed.data

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'No programme found' }, { status: 404 })
  const { programmeId, db: prisma } = scope

  // Bound to the programme as well as the id, and the fields are listed rather
  // than spread from the request. The previous form passed the whole body into
  // `update`, which let a caller move an item into another funder's programme
  // by naming it, or reach a nested write through it.
  const updated = await prisma.logFrameItem.updateMany({
    where: { id, programmeId },
    data,
  })
  if (updated.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const item = await prisma.logFrameItem.findFirst({ where: { id, programmeId } })
  return NextResponse.json(item)
}

export async function DELETE(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'No programme found' }, { status: 404 })
  const { programmeId, db: prisma } = scope

  const removed = await prisma.logFrameItem.deleteMany({ where: { id, programmeId } })
  if (removed.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
