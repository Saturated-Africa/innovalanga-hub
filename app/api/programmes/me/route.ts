import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/programmes/me
 * Returns the active programmeId for the current user.
 * super_admin: first programme in DB
 * other roles: their assigned programme
 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let programmeId = session.user.programmeId ?? null

  if (!programmeId) {
    // super_admin — use first programme
    const first = await prisma.programme.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } })
    programmeId = first?.id ?? null
  }

  return NextResponse.json({ programmeId })
}
