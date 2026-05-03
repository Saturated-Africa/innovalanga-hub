import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

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

  const { searchParams } = new URL(req.url)
  const programmeId = searchParams.get('programmeId')
  if (!programmeId) return NextResponse.json({ error: 'programmeId required' }, { status: 400 })

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

  const count = await prisma.beneficiaryCount.create({
    data: {
      ...parsed.data,
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
