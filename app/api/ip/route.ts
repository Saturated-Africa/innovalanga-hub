import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/ip?programmeId=xxx
 * Returns all IP assessments for a programme (admin/facilitator view)
 */
export async function GET(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator', 'funder_viewer'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const programmeId = searchParams.get('programmeId')

  // Resolve programme
  let pid = programmeId
  if (!pid) {
    pid = session.user.programmeId ?? null
    if (!pid) {
      const first = await prisma.programme.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } })
      pid = first?.id ?? null
    }
  }

  const assessments = await prisma.iPAssessment.findMany({
    where: {
      innovator: {
        cohort: { programmeId: pid ?? undefined },
      },
    },
    include: {
      innovator: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          businessName: true,
          cohort: { select: { name: true } },
          region: { select: { name: true } },
        },
      },
    },
    orderBy: { completedAt: 'desc' },
  })

  return NextResponse.json(assessments)
}
