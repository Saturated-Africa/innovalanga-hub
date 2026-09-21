import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { tenantScope } from '@/lib/tenant-db'
import { innovatorInProgramme } from '@/lib/authz'

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
  /**
   * Documents offered as evidence, per dimension.
   *
   * Sent with the assessment rather than attached afterwards, because the assessor
   * is deciding the score and choosing what shows it in the same moment. A separate
   * step would be a step that gets skipped.
   */
  evidence: z
    .array(
      z.object({
        dimension: z.enum(['trl', 'brl', 'mrl', 'irl']),
        documentId: z.string().min(1),
        note: z.string().trim().max(500).optional(),
      })
    )
    .max(40)
    .optional(),
})

/**
 * Who carried out the assessment is taken from the session, not the request.
 *
 * It used to be a required field in the body, which meant the name attached to
 * a locked, audited score was whatever the client typed. An assessment is the
 * record a funder reads to see whether a participant progressed; its author has
 * to be the person who actually submitted it.
 */

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
    innovatorId, period, trlScore, brlScore, irlScore, mrlScore, evidence,
    trlJustification, brlJustification, irlJustification, mrlJustification,
    dropJustification,
  } = parsed.data

  const assessedBy = session.user.name ?? session.user.email ?? 'Unknown'

  // The participant has to be in the caller's programme. Without this a
  // facilitator could file a locked score against any participant on the
  // platform, and a locked assessment is not editable afterwards.
  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  if (!(await innovatorInProgramme(innovatorId, programmeId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

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

  /*
   * Every document offered has to belong to this participant.
   *
   * Row-level security confines the query to the programme, which is not the same
   * question: without this check a facilitator could attach another participant's
   * bank statement to this score, inside the same programme, and the evidence trail
   * would point at the wrong person's business.
   */
  const offered = evidence ?? []
  if (offered.length > 0) {
    const ids = [...new Set(offered.map((e) => e.documentId))]
    const theirs = await prisma.document.findMany({
      where: { id: { in: ids }, innovatorId },
      select: { id: true },
    })
    if (theirs.length !== ids.length) {
      return NextResponse.json(
        { error: 'One of those documents does not belong to this participant.' },
        { status: 400 }
      )
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
      // Written with the assessment, so a locked score and the documents behind it
      // arrive together or not at all.
      evidence: {
        create: offered.map((e) => ({
          dimension: e.dimension,
          documentId: e.documentId,
          note: e.note ?? null,
          linkedByUserId: session.user.id,
        })),
      },
    },
  })

  await prisma.auditLog.create({
    data: {
      innovatorId,
      actorId: session.user.id,
      action: 'assessment.created',
      entityType: 'Assessment',
      entityId: assessment.id,
      diff: {
        period,
        trlScore,
        brlScore,
        irlScore,
        mrlScore,
        evidenceLinked: offered.length,
      },
    },
  })

  return NextResponse.json(assessment, { status: 201 })
}
