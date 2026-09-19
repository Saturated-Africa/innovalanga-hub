import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { tenantScope } from '@/lib/tenant-db'

/**
 * POST /api/assessments/[id]/evidence
 *
 * Attach a document to a locked assessment's score.
 *
 * An assessment locks on submission and its scores cannot change. Evidence is
 * different: a host site letter sitting in somebody's email, a bank statement in
 * the post, a certificate that arrives a week later. Refusing those would mean the
 * evidence trail is only ever as complete as the assessor's luck on the day.
 *
 * So links can be added to a locked assessment. They cannot be removed, and there
 * is deliberately no route that does: taking evidence away after the fact is how a
 * record quietly stops supporting the score it was filed against. A document
 * attached in error is corrected by a note, or by deleting the document itself
 * through the vault, which is visible and audited.
 */
const schema = z.object({
  dimension: z.enum(['trl', 'brl', 'mrl', 'irl']),
  documentId: z.string().min(1),
  note: z.string().trim().max(500).optional(),
})

const MAY_LINK = ['super_admin', 'facilitator']

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!MAY_LINK.includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { dimension, documentId, note } = parsed.data

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { db: prisma } = scope

  const assessment = await prisma.assessment.findFirst({
    where: { id: params.id },
    select: { id: true, innovatorId: true, period: true },
  })
  if (!assessment) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // The document has to belong to the participant this assessment is about. The
  // tenant connection confines this to one programme, which is a different
  // question: within a programme, attaching another participant's document would
  // point the evidence trail at the wrong person's business.
  const document = await prisma.document.findFirst({
    where: { id: documentId, innovatorId: assessment.innovatorId },
    select: { id: true, name: true },
  })
  if (!document) {
    return NextResponse.json(
      { error: 'That document does not belong to this participant.' },
      { status: 400 }
    )
  }

  const existing = await prisma.assessmentEvidence.findFirst({
    where: { assessmentId: assessment.id, dimension, documentId },
    select: { id: true },
  })
  if (existing) {
    // Not an error. Attaching the same document twice is a double click, and the
    // unique index would refuse it with a message nobody can act on.
    return NextResponse.json({ id: existing.id, alreadyLinked: true })
  }

  const link = await prisma.assessmentEvidence.create({
    data: {
      assessmentId: assessment.id,
      documentId: document.id,
      dimension,
      note: note ?? null,
      linkedByUserId: session.user.id,
    },
    select: { id: true, dimension: true },
  })

  await prisma.auditLog.create({
    data: {
      innovatorId: assessment.innovatorId,
      actorId: session.user.id,
      action: 'assessment.evidence.linked',
      entityType: 'AssessmentEvidence',
      entityId: link.id,
      diff: {
        assessmentId: assessment.id,
        period: assessment.period,
        dimension,
        documentName: document.name,
      },
    },
  })

  return NextResponse.json({ id: link.id, dimension: link.dimension }, { status: 201 })
}
