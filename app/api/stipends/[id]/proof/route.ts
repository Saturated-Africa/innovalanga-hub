import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { randomBytes, randomUUID } from 'crypto'
import { ProofKind } from '@prisma/client'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getS3, bucket, PRESIGN_TTL } from '@/lib/s3'
import type { PrismaClient } from '@prisma/client'
import { tenantScope } from '@/lib/tenant-db'
import {
  isAllowedUploadType,
  buildStipendProofKey,
  safeDisplayName,
  MAX_UPLOAD_BYTES,
} from '@/lib/uploads'

/**
 * Proof of payment for one stipend.
 *
 * POST with `?step=sign` returns a presigned upload URL; POST with the stored
 * key records the evidence and, optionally, marks the stipend paid. The two
 * steps exist because the file goes straight to storage and never through this
 * server.
 *
 * Marking paid is folded in on purpose. A proof of payment for a stipend that
 * the register still shows as unpaid is a contradiction somebody has to
 * reconcile later, so the action that supplies the evidence is also the action
 * that records the payment.
 */

const ROLES = ['super_admin', 'facilitator']

const signSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
})

const saveSchema = z.object({
  kind: z.nativeEnum(ProofKind).default(ProofKind.ProofOfPayment),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  s3Key: z.string().min(1).max(500),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  /** When the money actually moved, as distinct from when this was recorded. */
  paidAt: z.coerce.date().optional(),
  paymentReference: z.string().trim().max(120).optional(),
})

/**
 * Scoped through the participant's cohort, as every participant record is.
 *
 * The connection is passed in rather than reached for. It is already confined
 * to one programme, so the `where` clause below is now a second statement of
 * the same thing rather than the only one.
 */
async function loadInScope(db: PrismaClient, id: string, programmeId: string) {
  return db.stipendRecord.findFirst({
    where: { id, innovator: { cohort: { programmeId } } },
    select: { id: true, paidAt: true },
  })
}

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  const record = await loadInScope(prisma, params.id, programmeId)
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const step = new URL(req.url).searchParams.get('step')
  const body = await req.json()

  if (step === 'sign') {
    const parsed = signSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
    }
    if (!isAllowedUploadType(parsed.data.contentType)) {
      return NextResponse.json({ error: 'That file type cannot be uploaded.' }, { status: 415 })
    }

    const s3Key = buildStipendProofKey(record.id, randomUUID(), parsed.data.contentType)
    const url = await getSignedUrl(
      getS3(),
      new PutObjectCommand({
        Bucket: bucket(),
        Key: s3Key,
        ContentType: parsed.data.contentType,
        ContentLength: parsed.data.sizeBytes,
      }),
      { expiresIn: PRESIGN_TTL }
    )
    return NextResponse.json({ url, s3Key })
  }

  const parsed = saveSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })
  }
  const { kind, filename, contentType, s3Key, sizeBytes, paidAt, paymentReference } = parsed.data

  if (!isAllowedUploadType(contentType)) {
    return NextResponse.json({ error: 'That file type cannot be uploaded.' }, { status: 415 })
  }

  // The key must be one this server issued for this stipend. Without the second
  // half of that check a caller could point a proof at any object in the bucket
  // and read it back through the public link.
  if (!s3Key.startsWith(`finance/stipends/${record.id}/proof/`)) {
    return NextResponse.json({ error: 'Invalid storage key' }, { status: 400 })
  }

  const proof = await prisma.$transaction(async (tx) => {
    const created = await tx.financeProof.create({
      data: {
        stipendRecordId: record.id,
        projectId: null,
        kind,
        filename: safeDisplayName(filename),
        contentType,
        s3Key,
        sizeBytes,
        shareToken: randomBytes(24).toString('base64url'),
        uploadedByUserId: session.user.id,
      },
      select: { id: true, filename: true, kind: true, shareToken: true },
    })

    // Evidence of payment implies the payment. Recorded here rather than left
    // for a separate action somebody may not take.
    if (paidAt || !record.paidAt) {
      await tx.stipendRecord.update({
        where: { id: record.id },
        data: {
          paidAt: paidAt ?? new Date(),
          status: 'Eligible',
          paymentReference: paymentReference ?? undefined,
          paidRecordedBy: session.user.id,
          paidRecordedAt: new Date(),
        },
      })
    }

    return created
  })

  await prisma.auditLog.create({
    data: {
      actorId: session.user.id,
      action: 'stipend.proof.uploaded',
      entityType: 'StipendRecord',
      entityId: record.id,
      diff: { kind, paidAt: paidAt?.toISOString() ?? null },
    },
  })

  return NextResponse.json({ ...proof, url: `/proof/${proof.shareToken}` }, { status: 201 })
}
