import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { resolveProgrammeId, assertProgrammeInScope } from '@/lib/scope'

const BeneficiarySchema = z.object({
  programmeId: z.string().min(1),
  cohortId: z.string().optional().nullable(),
  periodLabel: z.string().min(1),
  periodStart: z.string(),
  periodEnd: z.string(),
  direct: z.number().int().min(0),
  indirect: z.number().int().min(0),
  female: z.number().int().min(0),
  youth: z.number().int().min(0),
  pwd: z.number().int().min(0),
  notes: z.string().optional(),
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

  const counts = await prisma.beneficiaryCount.findMany({
    where: { programmeId },
    include: { cohort: { select: { name: true } } },
    orderBy: { periodStart: 'desc' },
  })
  return NextResponse.json(counts)
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = BeneficiarySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // The client supplies programmeId in the body; validate it against the
  // session rather than trusting it, otherwise this is a cross-programme write.
  const programmeId = await assertProgrammeInScope(session, parsed.data.programmeId)
  if (!programmeId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const count = await prisma.beneficiaryCount.create({
    data: {
      ...parsed.data,
      programmeId,
      periodStart: new Date(parsed.data.periodStart),
      periodEnd: new Date(parsed.data.periodEnd),
      recordedBy: session.user.name ?? session.user.email ?? 'Unknown',
    },
  })
  return NextResponse.json(count, { status: 201 })
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

  await prisma.beneficiaryCount.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
