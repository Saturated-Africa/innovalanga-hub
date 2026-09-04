import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveProgrammeId } from '@/lib/scope'

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

  // Programme comes from the session, never the query string.
  const pid = await resolveProgrammeId(session)

  // Fail closed. The previous form was `programmeId: pid ?? undefined`, and
  // Prisma DROPS an undefined filter — so a null programme returned every
  // programme's IP assessments rather than none.
  if (!pid) return NextResponse.json({ error: 'No programme found' }, { status: 404 })

  const assessments = await prisma.iPAssessment.findMany({
    where: {
      innovator: {
        cohort: { programmeId: pid },
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

  // Funders get the IP picture without the people. CLAUDE.md states this role
  // sees no PII; the code did not honour that.
  if (session.user.role === 'funder_viewer') {
    return NextResponse.json(
      assessments.map((a) => ({
        id: a.id,
        primaryRec: a.primaryRec,
        recommendations: a.recommendations,
        status: a.status,
        completedAt: a.completedAt,
        cohort: a.innovator.cohort?.name ?? null,
        region: a.innovator.region?.name ?? null,
      }))
    )
  }

  return NextResponse.json(assessments)
}
