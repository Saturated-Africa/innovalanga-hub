import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; overrideId: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const override = await prisma.mentorDateOverride.findUnique({ where: { id: params.overrideId } })
  if (!override) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (override.mentorId !== params.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (session.user.role === 'mentor') {
    const mentor = await prisma.mentorProfile.findUnique({ where: { id: params.id } })
    if (mentor?.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  } else if (session.user.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await prisma.mentorDateOverride.delete({ where: { id: params.overrideId } })
  return NextResponse.json({ ok: true })
}
