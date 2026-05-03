import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const ToCSchema = z.object({
  programmeId: z.string().min(1),
  problem: z.string().optional(),
  vision: z.string().optional(),
  inputs: z.string().optional(),
  activities: z.string().optional(),
  outputs: z.string().optional(),
  outcomes: z.string().optional(),
  impact: z.string().optional(),
  assumptions: z.string().optional(),
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

  const toc = await prisma.theoryOfChange.findUnique({ where: { programmeId } })
  return NextResponse.json(toc ?? null)
}

export async function PUT(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = ToCSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { programmeId, ...data } = parsed.data

  const toc = await prisma.theoryOfChange.upsert({
    where: { programmeId },
    create: { programmeId, ...data },
    update: data,
  })

  return NextResponse.json(toc)
}
