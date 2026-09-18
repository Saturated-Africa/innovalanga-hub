import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import { ProofKind } from '@prisma/client'
import { tenantScope } from '@/lib/tenant-db'
import { safeDisplayName, isAllowedUploadType, MAX_UPLOAD_BYTES } from '@/lib/uploads'

/**
 * POST /api/finance/proofs
 *
 * Record a piece of evidence after it has reached storage, and mint the durable
 * link that will sit beside the transaction in the exported workbook.
 */

const schema = z.object({
  projectId: z.string().min(1),
  transactionId: z.string().min(1).optional(),
  kind: z.nativeEnum(ProofKind),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  s3Key: z.string().min(1).max(500),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
})

/** The exact shape `buildFinanceProofKey` produces. Anything else is refused. */
const KEY_PATTERN = /^finance\/[A-Za-z0-9_-]+\/proof\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/

/**
 * 24 random bytes, base64url encoded to 32 characters.
 *
 * This is the whole of the authorisation for the link: a funder opening it has
 * no account and presents nothing else. It has to be long enough that guessing
 * is not a strategy, and it must never be derived from a database id.
 */
function mintShareToken(): string {
  return randomBytes(24).toString('base64url')
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })
  }

  const { projectId, transactionId, kind, filename, contentType, s3Key, sizeBytes } = parsed.data

  if (!isAllowedUploadType(contentType)) {
    return NextResponse.json({ error: 'That file type cannot be uploaded.' }, { status: 415 })
  }

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'No programme found' }, { status: 404 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  const project = await prisma.financeProject.findFirst({
    where: { id: projectId, programmeId },
    select: { id: true },
  })
  if (!project) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // The key must be one this server issued, and it must belong to this project.
  // Without both checks a caller could point a proof record at any object in
  // the bucket and then read it back through the public link route.
  if (!KEY_PATTERN.test(s3Key) || !s3Key.startsWith(`finance/${project.id}/proof/`)) {
    return NextResponse.json({ error: 'Invalid storage key' }, { status: 400 })
  }

  if (transactionId) {
    const transaction = await prisma.financeTransaction.findFirst({
      where: { id: transactionId, projectId: project.id },
      select: { id: true },
    })
    if (!transaction) {
      return NextResponse.json({ error: 'Transaction not found in this project' }, { status: 403 })
    }
  }

  const proof = await prisma.financeProof.create({
    data: {
      projectId: project.id,
      transactionId: transactionId ?? null,
      kind,
      filename: safeDisplayName(filename),
      contentType,
      s3Key,
      sizeBytes,
      shareToken: mintShareToken(),
      uploadedByUserId: session.user.id,
    },
    select: { id: true, filename: true, kind: true, shareToken: true },
  })

  await prisma.auditLog.create({
    data: {
      actorId: session.user.id,
      action: 'finance.proof.uploaded',
      entityType: 'FinanceProof',
      entityId: proof.id,
      diff: { kind, transactionId: transactionId ?? null },
    },
  })

  return NextResponse.json(
    { ...proof, url: `/proof/${proof.shareToken}` },
    { status: 201 }
  )
}
