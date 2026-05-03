import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const createSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().max(200).optional(),
})

async function authoriseMentor(mentorId: string, userId: string, role: string) {
  if (role === 'super_admin') return true
  if (role !== 'mentor') return false
  const mentor = await prisma.mentorProfile.findUnique({ where: { id: mentorId } })
  return mentor?.userId === userId
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const blackouts = await prisma.blackoutPeriod.findMany({
    where: { mentorId: params.id, endDate: { gte: new Date() } },
    orderBy: { startDate: 'asc' },
  })
  return NextResponse.json(blackouts)
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await authoriseMentor(params.id, session.user.id, session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  if (new Date(parsed.data.startDate) > new Date(parsed.data.endDate)) {
    return NextResponse.json({ error: 'Start date must be before end date' }, { status: 400 })
  }

  const blackout = await prisma.blackoutPeriod.create({
    data: {
      mentorId: params.id,
      startDate: new Date(parsed.data.startDate),
      endDate: new Date(parsed.data.endDate),
      reason: parsed.data.reason,
    },
  })
  return NextResponse.json(blackout, { status: 201 })
}
