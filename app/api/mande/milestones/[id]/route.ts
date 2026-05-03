import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const data: Record<string, unknown> = { ...body }

  if (body.targetDate) data.targetDate = new Date(body.targetDate)
  if (body.completedDate) data.completedDate = new Date(body.completedDate)
  if (body.completedDate === null) data.completedDate = null

  const milestone = await prisma.milestoneTracker.update({
    where: { id: params.id },
    data,
  })
  return NextResponse.json(milestone)
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await prisma.milestoneTracker.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
