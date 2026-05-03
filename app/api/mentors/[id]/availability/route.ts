import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  slots: z.array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
      endTime: z.string().regex(/^\d{2}:\d{2}$/),
      bufferMins: z.number().int().min(0).default(15),
    })
  ),
})

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const mentor = await prisma.mentorProfile.findUnique({ where: { id: params.id } })
  if (!mentor) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Only the mentor themselves or admin can update
  if (session.user.role === 'mentor' && mentor.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  // Replace all availability with transaction
  await prisma.$transaction([
    prisma.mentorAvailability.deleteMany({ where: { mentorId: params.id } }),
    prisma.mentorAvailability.createMany({
      data: parsed.data.slots.map((s) => ({ ...s, mentorId: params.id })),
    }),
  ])

  return NextResponse.json({ ok: true })
}
