import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  innovatorId: z.string().min(1),
  period: z.string().min(1),
  trlScore: z.number().int().min(1).max(9),
  brlScore: z.number().int().min(1).max(9),
  irlScore: z.number().int().min(1).max(9),
  mrlScore: z.number().int().min(1).max(9).optional(),
  trlJustification: z.string().optional(),
  brlJustification: z.string().optional(),
  irlJustification: z.string().optional(),
  mrlJustification: z.string().optional(),
  dropJustification: z.string().optional(),
  assessedBy: z.string().min(1),
})

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const {
    innovatorId, period, trlScore, brlScore, irlScore, mrlScore,
    trlJustification, brlJustification, irlJustification, mrlJustification,
    dropJustification, assessedBy,
  } = parsed.data

  // Check for duplicate
  const existing = await prisma.assessment.findUnique({
    where: { innovatorId_period: { innovatorId, period } },
  })
  if (existing) {
    return NextResponse.json({ error: 'Assessment for this period already exists.' }, { status: 409 })
  }

  // Validate drop rule — look up period order from programme's AssessmentPeriodDef
  const innovator = await prisma.innovatorProfile.findUnique({
    where: { id: innovatorId },
    include: { cohort: { include: { programme: { include: { assessmentPeriods: { orderBy: { order: 'asc' } } } } } } },
  })

  if (innovator) {
    const periods = innovator.cohort.programme.assessmentPeriods
    const periodIdx = periods.findIndex((p) => p.key === period)
    if (periodIdx > 0) {
      const prevKey = periods[periodIdx - 1].key
      const prev = await prisma.assessment.findUnique({
        where: { innovatorId_period: { innovatorId, period: prevKey } },
      })
      if (prev) {
        const drops = [
          prev.trlScore - trlScore,
          prev.brlScore - brlScore,
          prev.irlScore - irlScore,
          prev.mrlScore != null && mrlScore != null ? prev.mrlScore - mrlScore : 0,
        ]
        if (drops.some((d) => d > 2) && !dropJustification?.trim()) {
          return NextResponse.json(
            { error: 'A drop justification is required when a score decreases by more than 2 points.' },
            { status: 422 }
          )
        }
      }
    }
  }

  const assessment = await prisma.assessment.create({
    data: {
      innovatorId,
      period,
      trlScore,
      brlScore,
      irlScore,
      mrlScore: mrlScore ?? null,
      trlJustification: trlJustification ?? null,
      brlJustification: brlJustification ?? null,
      irlJustification: irlJustification ?? null,
      mrlJustification: mrlJustification ?? null,
      dropJustification: dropJustification ?? null,
      assessedBy,
      lockedAt: new Date(),
    },
  })

  await prisma.auditLog.create({
    data: {
      innovatorId,
      actorId: session.user.id,
      action: 'assessment.created',
      entityType: 'Assessment',
      entityId: assessment.id,
      diff: { period, trlScore, brlScore, irlScore, mrlScore },
    },
  })

  return NextResponse.json(assessment, { status: 201 })
}
