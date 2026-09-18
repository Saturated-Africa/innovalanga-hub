import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { deriveRecommendations } from '@/lib/ip-engine'
import { z } from 'zod'
import type { Session } from 'next-auth'
import type { PrismaClient } from '@prisma/client'
import { tenantScope } from '@/lib/tenant-db'
import { innovatorInProgramme } from '@/lib/authz'

/**
 * One participant's intellectual property assessment.
 *
 * Every verb here checked a role and then acted on whichever participant the
 * path named. An IP assessment holds invention disclosure answers - what has
 * been built, what is novel, what has been published and when - which is
 * commercially sensitive and, for a patent, time-critical. A facilitator on one
 * funder's programme could read, overwrite or annotate any participant's on the
 * platform.
 *
 * The guard below is the same for all three verbs: a participant reaches their
 * own record, an adviser reaches records inside their own programme, and nobody
 * reaches anything else.
 */

const ADVISERS = ['super_admin', 'facilitator']

/**
 * Either a connection confined to the caller's programme, or the status to
 * refuse with.
 *
 * The two are returned together because they are decided together, and because
 * a caller that has been cleared should not then have to work out which
 * connection it is entitled to. Refusing with a status rather than a boolean
 * keeps the distinction between a role that is never allowed here and one that
 * is, but not for this participant: the second answers 404, because telling a
 * facilitator on another programme that the record exists is itself a
 * disclosure.
 */
type Guarded = { db: PrismaClient } | { status: number }

async function guard(
  session: Session,
  innovatorId: string,
  advisersOnly = false
): Promise<Guarded> {
  if (session.user.role !== 'innovator' && !ADVISERS.includes(session.user.role)) {
    return { status: 403 }
  }
  if (advisersOnly && session.user.role === 'innovator') {
    return { status: 403 }
  }

  const scope = await tenantScope(session)
  if (!scope) return { status: 404 }
  const { programmeId, db } = scope

  if (session.user.role === 'innovator') {
    // Their own record and no other. The connection is already confined to
    // their programme, so this is the narrower of the two checks.
    const profile = await db.innovatorProfile.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    })
    return profile?.id === innovatorId ? { db } : { status: 403 }
  }

  return (await innovatorInProgramme(innovatorId, programmeId)) ? { db } : { status: 404 }
}

export async function GET(
  _req: Request,
  { params }: { params: { innovatorId: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const guarded = await guard(session, params.innovatorId)
  if ('status' in guarded) {
    return NextResponse.json({ error: 'Not found' }, { status: guarded.status })
  }

  const assessment = await guarded.db.iPAssessment.findUnique({
    where: { innovatorId: params.innovatorId },
  })

  return NextResponse.json(assessment ?? null)
}

const SubmitSchema = z.object({
  answers: z.record(z.string()),
})

/**
 * POST /api/ip/[innovatorId]
 * Submit questionnaire answers - runs the engine, upserts the assessment.
 */
export async function POST(
  req: Request,
  { params }: { params: { innovatorId: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const guarded = await guard(session, params.innovatorId)
  if ('status' in guarded) {
    return NextResponse.json({ error: 'Not found' }, { status: guarded.status })
  }

  const parsed = SubmitSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const result = deriveRecommendations(parsed.data.answers)

  const assessment = await guarded.db.iPAssessment.upsert({
    where: { innovatorId: params.innovatorId },
    create: {
      innovatorId: params.innovatorId,
      answers: parsed.data.answers,
      recommendations: result.recommendations as any,
      primaryRec: result.primaryRec as any,
      reasoning: result.reasoning,
      status: 'Assessed',
      completedAt: new Date(),
    },
    update: {
      answers: parsed.data.answers,
      recommendations: result.recommendations as any,
      primaryRec: result.primaryRec as any,
      reasoning: result.reasoning,
      status: 'Assessed',
      completedAt: new Date(),
      // A fresh submission invalidates the previous review. Leaving the adviser
      // notes in place would attach a sign-off to answers nobody signed off on.
      advisorNotes: null,
      reviewedBy: null,
      reviewedAt: null,
    },
  })

  return NextResponse.json(assessment, { status: 201 })
}

const PatchSchema = z.object({
  advisorNotes: z.string().trim().max(5000).optional(),
  status: z
    .enum(['NotAssessed', 'Assessed', 'ApplicationPending', 'Protected', 'Expired'])
    .optional(),
})

/**
 * PATCH /api/ip/[innovatorId]
 * An adviser adds notes or moves the protection status on.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { innovatorId: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const guarded = await guard(session, params.innovatorId, true)
  if ('status' in guarded) {
    return NextResponse.json({ error: 'Not found' }, { status: guarded.status })
  }

  const parsed = PatchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // updateMany rather than update, so a participant with no assessment yet
  // answers 404 instead of surfacing a Prisma error as a 500.
  const updated = await guarded.db.iPAssessment.updateMany({
    where: { innovatorId: params.innovatorId },
    data: {
      ...parsed.data,
      reviewedBy: session.user.name ?? session.user.email ?? 'Unknown',
      reviewedAt: new Date(),
    },
  })
  if (updated.count === 0) {
    return NextResponse.json({ error: 'No assessment to update.' }, { status: 404 })
  }

  const assessment = await guarded.db.iPAssessment.findUnique({
    where: { innovatorId: params.innovatorId },
  })
  return NextResponse.json(assessment)
}
