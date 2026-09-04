import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { DEFAULT_EVENT_COLOR } from '@/lib/event-colors'

const schema = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  durationMins: z.number().int().min(15).max(480),
  bufferBefore: z.number().int().min(0).max(60).optional().default(0),
  bufferAfter: z.number().int().min(0).max(60).optional().default(15),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default(DEFAULT_EVENT_COLOR),
  active: z.boolean().optional().default(true),
})

interface Params { params: { id: string } }

export async function GET(_req: Request, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const mentor = await prisma.mentorProfile.findFirst({
    where: { id: params.id },
  })
  if (!mentor) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const eventTypes = await prisma.eventType.findMany({
    where: { mentorId: params.id },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json(eventTypes)
}

export async function POST(req: Request, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const mentor = await prisma.mentorProfile.findFirst({
    where: { id: params.id, userId: session.user.id },
  })
  if (!mentor && session.user.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const existing = await prisma.eventType.findUnique({
    where: { mentorId_slug: { mentorId: params.id, slug: parsed.data.slug } },
  })
  if (existing) {
    return NextResponse.json({ error: 'An event type with this slug already exists.' }, { status: 409 })
  }

  const eventType = await prisma.eventType.create({
    data: { mentorId: params.id, ...parsed.data },
  })
  return NextResponse.json(eventType, { status: 201 })
}

export async function PATCH(req: Request, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const mentor = await prisma.mentorProfile.findFirst({
    where: { id: params.id, userId: session.user.id },
  })
  if (!mentor && session.user.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { id, ...rest } = body
  if (!id) return NextResponse.json({ error: 'Missing event type id' }, { status: 400 })

  const parsed = schema.partial().safeParse(rest)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const updated = await prisma.eventType.update({
    where: { id },
    data: parsed.data,
  })
  return NextResponse.json(updated)
}

export async function DELETE(req: Request, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const mentor = await prisma.mentorProfile.findFirst({
    where: { id: params.id, userId: session.user.id },
  })
  if (!mentor && session.user.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  await prisma.eventType.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
