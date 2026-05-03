import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const createSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  available: z.boolean(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
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

  const overrides = await prisma.mentorDateOverride.findMany({
    where: { mentorId: params.id, date: { gte: new Date() } },
    orderBy: { date: 'asc' },
  })
  return NextResponse.json(overrides)
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

  const override = await prisma.mentorDateOverride.create({
    data: { ...parsed.data, mentorId: params.id, date: new Date(parsed.data.date) },
  })
  return NextResponse.json(override, { status: 201 })
}
