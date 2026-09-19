import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { randomUUID, randomBytes } from 'crypto'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getS3, bucket, PRESIGN_TTL } from '@/lib/s3'
import { tenantScope } from '@/lib/tenant-db'
import {
  isAllowedUploadType,
  buildTrancheProofKey,
  safeDisplayName,
  MAX_UPLOAD_BYTES,
} from '@/lib/uploads'

/**
 * Evidence that a tranche was actually paid.
 *
 * POST  - presigned PUT, to send the bank confirmation to S3
 * PUT   - record it once it has landed, and mint the durable share link
 *
 * The other half of the audit trail. Expenditure proof evidences how grant money
 * was spent; this evidences it leaving, which is the side a funder reconciling
 * disbursements asks for first because it is their money going out.
 *
 * Two rules worth stating.
 *
 * Only the fund manager may attach, matching who may record the payment itself.
 * A facilitator approves a tranche but does not pay it, so they have no bank
 * confirmation to file - and evidence of a payment should come from whoever made
 * it.
 *
 * And only a paid tranche may carry proof of payment. Filing one against a
 * pending tranche would put a document in front of a funder attesting to a
 * transfer that has not happened.
 */

const presignSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
})

const recordSchema = presignSchema.extend({
  s3Key: z.string().min(1).max(500),
})

/** Paying is the fund manager's act, and so is evidencing it. */
const MAY_ATTACH = ['super_admin']

/** The exact shape buildTrancheProofKey produces. Anything else is refused. */
const KEY_PATTERN =
  /^finance\/tranches\/[A-Za-z0-9_-]+\/proof\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/

/**
 * 24 random bytes, base64url to 32 characters.
 *
 * This token is the whole of the authorisation for the link a funder opens, so it
 * must be unguessable and must never be derived from a database id.
 */
function mintShareToken(): string {
  return randomBytes(24).toString('base64url')
}

/**
 * Resolve the tranche and confirm the caller may attach evidence to it.
 *
 * Shared by both verbs so they cannot drift: a presign the record step would
 * refuse is a URL that uploads a file nothing will ever point at.
 */
async function authorise(
  session: Awaited<ReturnType<typeof getSession>>,
  grantId: string,
  trancheId: string
) {
  if (!session) return { error: 'Unauthorized' as const, status: 401 }
  if (!MAY_ATTACH.includes(session.user.role)) {
    return {
      error: 'Filing proof of payment is the fund manager’s job.' as const,
      status: 403,
    }
  }

  const scope = await tenantScope(session)
  if (!scope) return { error: 'Not found' as const, status: 404 }
  const { db: prisma } = scope

  const tranche = await prisma.grantTranche.findFirst({
    where: { id: trancheId, grantId },
    select: {
      id: true,
      status: true,
      sequence: true,
      amount: true,
      grant: { select: { id: true, innovatorId: true } },
    },
  })
  if (!tranche) return { error: 'Not found' as const, status: 404 }

  if (tranche.status !== 'Paid') {
    return {
      error:
        'This tranche has not been paid yet, so there is no payment to evidence. Record the payment first.' as const,
      status: 409,
    }
  }

  return { prisma, tranche, actorId: session.user.id }
}

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string; trancheId: string }> }
) {
  const params = await props.params
  const session = await getSession()

  const parsed = presignSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { contentType, sizeBytes } = parsed.data

  if (!isAllowedUploadType(contentType)) {
    return NextResponse.json({ error: 'That file type cannot be uploaded.' }, { status: 415 })
  }

  const auth = await authorise(session, params.id, params.trancheId)
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const s3Key = buildTrancheProofKey(auth.tranche.id, randomUUID(), contentType)

  // The length is signed, so the URL cannot be reused for a different body, and
  // the key is built entirely from values the server chose.
  const url = await getSignedUrl(
    getS3(),
    new PutObjectCommand({
      Bucket: bucket(),
      Key: s3Key,
      ContentType: contentType,
      ContentLength: sizeBytes,
    }),
    { expiresIn: PRESIGN_TTL }
  )

  return NextResponse.json({ url, s3Key })
}

export async function PUT(
  req: Request,
  props: { params: Promise<{ id: string; trancheId: string }> }
) {
  const params = await props.params
  const session = await getSession()

  const parsed = recordSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { filename, contentType, sizeBytes, s3Key } = parsed.data

  if (!isAllowedUploadType(contentType)) {
    return NextResponse.json({ error: 'That file type cannot be uploaded.' }, { status: 415 })
  }

  const auth = await authorise(session, params.id, params.trancheId)
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const { prisma, tranche } = auth

  // The key has to be one this server issued, for this tranche. Without both
  // checks a caller could point a proof record at any object in the bucket and
  // then read it back through the public share link.
  if (!KEY_PATTERN.test(s3Key) || !s3Key.startsWith(`finance/tranches/${tranche.id}/proof/`)) {
    return NextResponse.json({ error: 'Invalid storage key' }, { status: 400 })
  }

  const proof = await prisma.financeProof.create({
    data: {
      grantTrancheId: tranche.id,
      kind: 'ProofOfPayment',
      filename: safeDisplayName(filename),
      s3Key,
      sizeBytes,
      contentType,
      shareToken: mintShareToken(),
      uploadedByUserId: auth.actorId,
    },
    select: { id: true, filename: true, shareToken: true },
  })

  await prisma.auditLog.create({
    data: {
      innovatorId: tranche.grant.innovatorId,
      actorId: auth.actorId,
      action: 'grant.tranche.proof',
      entityType: 'FinanceProof',
      entityId: proof.id,
      diff: {
        grantId: tranche.grant.id,
        trancheId: tranche.id,
        sequence: tranche.sequence,
        amount: tranche.amount.toString(),
        filename: proof.filename,
        sizeBytes,
      },
    },
  })

  return NextResponse.json(
    { id: proof.id, filename: proof.filename, shareToken: proof.shareToken },
    { status: 201 }
  )
}
