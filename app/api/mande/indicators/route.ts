import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

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

  const { searchParams } = new URL(req.url)
  const programmeId = searchParams.get('programmeId')
  if (!programmeId) return NextResponse.json({ error: 'programmeId required' }, { status: 400 })

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

  const indicator = await prisma.indicator.create({ data: parsed.data })
  return NextResponse.json(indicator, { status: 201 })
}
