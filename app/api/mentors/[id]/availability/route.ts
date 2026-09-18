import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { canActAsMentor } from '@/lib/authz'

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

export async function PUT(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const mentor = await prisma.mentorProfile.findUnique({ where: { id: params.id } })
  if (!mentor) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // The guard here used to read `if (role === 'mentor' && mentor.userId !== id)`,
  // so the ownership test ran ONLY for mentors. Every other authenticated role
  // fell straight through to the deleteMany below and could wipe and rewrite any
  // mentor's entire availability. Registration is public, so that was a
  // register-then-destroy chain against a live booking calendar.
  if (!(await canActAsMentor(session, params.id))) {
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
