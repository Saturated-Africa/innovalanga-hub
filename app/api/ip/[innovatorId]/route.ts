import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { deriveRecommendations } from '@/lib/ip-engine'
import { z } from 'zod'

/**
 * GET /api/ip/[innovatorId]
 * Returns the IP assessment for a specific innovator.
 * Accessible by: innovator (own), facilitator, super_admin
 */
export async function GET(
  _req: Request,
  { params }: { params: { innovatorId: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Innovators may only see their own
  if (session.user.role === 'innovator') {
    const profile = await prisma.innovatorProfile.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    })
    if (profile?.id !== params.innovatorId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  } else if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const assessment = await prisma.iPAssessment.findUnique({
    where: { innovatorId: params.innovatorId },
  })

  return NextResponse.json(assessment ?? null)
}

const SubmitSchema = z.object({
  answers: z.record(z.string()),
})

/**
 * POST /api/ip/[innovatorId]
 * Submit questionnaire answers — runs engine, upserts IPAssessment.
 * Accessible by: innovator (own), facilitator, super_admin
 */
export async function POST(
  req: Request,
  { params }: { params: { innovatorId: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Innovators may only submit for themselves
  if (session.user.role === 'innovator') {
    const profile = await prisma.innovatorProfile.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    })
    if (profile?.id !== params.innovatorId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  } else if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = SubmitSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const result = deriveRecommendations(parsed.data.answers)

  const assessment = await prisma.iPAssessment.upsert({
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
      advisorNotes: null,
      reviewedBy: null,
      reviewedAt: null,
    },
  })

  return NextResponse.json(assessment, { status: 201 })
}

const PatchSchema = z.object({
  advisorNotes: z.string().optional(),
  status: z.enum(['NotAssessed', 'Assessed', 'ApplicationPending', 'Protected', 'Expired']).optional(),
})

/**
 * PATCH /api/ip/[innovatorId]
 * Advisor adds notes or updates IP status.
 * Accessible by: facilitator, super_admin
 */
export async function PATCH(
  req: Request,
  { params }: { params: { innovatorId: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const assessment = await prisma.iPAssessment.update({
    where: { innovatorId: params.innovatorId },
    data: {
      ...parsed.data,
      reviewedBy: session.user.name ?? session.user.email ?? 'Unknown',
      reviewedAt: new Date(),
    },
  })

  return NextResponse.json(assessment)
}
