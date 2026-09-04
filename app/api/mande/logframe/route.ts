import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { resolveProgrammeId, assertProgrammeInScope } from '@/lib/scope'

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
  const programmeId = await resolveProgrammeId(session)
  if (!programmeId) return NextResponse.json({ error: 'No programme found' }, { status: 404 })

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

  const item = await prisma.logFrameItem.create({
    data: { ...parsed.data, programmeId },
  })
  return NextResponse.json(item, { status: 201 })
}

export async function PATCH(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { id, ...data } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const item = await prisma.logFrameItem.update({ where: { id }, data })
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

  await prisma.logFrameItem.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
