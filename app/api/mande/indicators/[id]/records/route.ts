import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const RecordSchema = z.object({
  periodLabel: z.string().min(1),
  periodStart: z.string(), // ISO date string
  periodEnd: z.string(),
  value: z.number(),
  notes: z.string().optional(),
})

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator', 'funder_viewer'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const records = await prisma.indicatorRecord.findMany({
    where: { indicatorId: params.id },
    orderBy: { periodStart: 'asc' },
  })
  return NextResponse.json(records)
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = RecordSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const record = await prisma.indicatorRecord.create({
    data: {
      indicatorId: params.id,
      periodLabel: parsed.data.periodLabel,
      periodStart: new Date(parsed.data.periodStart),
      periodEnd: new Date(parsed.data.periodEnd),
      value: parsed.data.value,
      notes: parsed.data.notes,
      recordedBy: session.user.name ?? session.user.email ?? 'Unknown',
    },
  })
  return NextResponse.json(record, { status: 201 })
}

export async function DELETE(
  req: Request,
  { params: _ }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const recordId = searchParams.get('recordId')
  if (!recordId) return NextResponse.json({ error: 'recordId required' }, { status: 400 })

  await prisma.indicatorRecord.delete({ where: { id: recordId } })
  return NextResponse.json({ ok: true })
}
