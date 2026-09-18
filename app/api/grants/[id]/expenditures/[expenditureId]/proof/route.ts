import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { randomUUID, randomBytes } from 'crypto'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getS3, bucket, PRESIGN_TTL } from '@/lib/s3'
import { tenantScope } from '@/lib/tenant-db'
import { callerInnovatorId } from '@/lib/authz'
import { participantMayEdit, type ExpenditureStatus } from '@/lib/funds/expenditure'
import {
  isAllowedUploadType,
  buildGrantProofKey,
  safeDisplayName,
  MAX_UPLOAD_BYTES,
} from '@/lib/uploads'

/**
 * Evidence for a reported expense.
 *
 * POST  - presigned PUT, for the participant or staff to send the file to S3
 * PUT   - record it once it has landed, and mint the durable share link
 *
 * Two requests rather than one because the file goes straight to S3 and never
 * passes through the app. The alternative is proxying every receipt through a
 * single small instance, which is slower and puts a 20 MiB body in the request
 * path of the one process serving every page.
 *
 * Unlike the project-evidence routes beside it, a participant may upload here.
 * They are the ones holding the receipts, and a reviewer accepting a described
 * expense with no document behind it is exactly the gap this closes. What they
 * may not do is attach anything to an expense that has already been reviewed,
 * since that would change the evidence under a decision already made.
 */

const presignSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
})

const recordSchema = presignSchema.extend({
  s3Key: z.string().min(1).max(500),
})

const STAFF = ['super_admin', 'facilitator']

/** The exact shape buildGrantProofKey produces. Anything else is refused. */
const KEY_PATTERN =
  /^finance\/grants\/[A-Za-z0-9_-]+\/proof\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/

/**
 * 24 random bytes, base64url to 32 characters.
 *
 * This token is the whole of the authorisation for the link a funder opens, so
 * it must be unguessable and must never be derived from a database id.
 */
function mintShareToken(): string {
  return randomBytes(24).toString('base64url')
}

/**
 * Resolve the expense and confirm the caller may attach evidence to it.
 *
 * Shared by both verbs so they cannot drift: a presign the record step would
 * refuse is a URL that uploads a file nothing will ever point at.
 */
async function authorise(
  session: Awaited<ReturnType<typeof getSession>>,
  grantId: string,
  expenditureId: string
) {
  if (!session) return { error: 'Unauthorized' as const, status: 401 }

  const isStaff = STAFF.includes(session.user.role)
  const ownInnovatorId = await callerInnovatorId(session)
  if (!isStaff && !ownInnovatorId) return { error: 'Forbidden' as const, status: 403 }

  const scope = await tenantScope(session)
  if (!scope) return { error: 'Not found' as const, status: 404 }
  const { db: prisma } = scope

  const expenditure = await prisma.grantExpenditure.findFirst({
    where: { id: expenditureId, grantId },
    select: {
      id: true,
      status: true,
      grant: { select: { id: true, innovatorId: true } },
    },
  })
  if (!expenditure) return { error: 'Not found' as const, status: 404 }

  // Row-level security is programme-scoped, not person-scoped, so the
  // participant's own id is applied here. Told it does not exist rather than
  // refused, because a refusal confirms whose expense it is.
  if (!isStaff && expenditure.grant.innovatorId !== ownInnovatorId) {
    return { error: 'Not found' as const, status: 404 }
  }

  // Staff may file evidence after the fact - a receipt that arrives late is
  // still the evidence for that expense. A participant may not, once a reviewer
  // has ruled on it.
  if (!isStaff && !participantMayEdit(expenditure.status as ExpenditureStatus)) {
    return {
      error: 'This expense has already been reviewed, so its evidence cannot be changed.' as const,
      status: 409,
    }
  }

  return { prisma, expenditure, isStaff, actorId: session.user.id }
}

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string; expenditureId: string }> }
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

  const auth = await authorise(session, params.id, params.expenditureId)
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const s3Key = buildGrantProofKey(auth.expenditure.id, randomUUID(), contentType)

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
  props: { params: Promise<{ id: string; expenditureId: string }> }
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

  const auth = await authorise(session, params.id, params.expenditureId)
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const { prisma, expenditure } = auth

  // The key has to be one this server issued, for this expense. Without both
  // checks a caller could point a proof record at any object in the bucket and
  // then read it back through the public share link.
  if (
    !KEY_PATTERN.test(s3Key) ||
    !s3Key.startsWith(`finance/grants/${expenditure.id}/proof/`)
  ) {
    return NextResponse.json({ error: 'Invalid storage key' }, { status: 400 })
  }

  const proof = await prisma.financeProof.create({
    data: {
      grantExpenditureId: expenditure.id,
      kind: 'Invoice',
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
      innovatorId: expenditure.grant.innovatorId,
      actorId: auth.actorId,
      action: 'grant.expenditure.proof',
      entityType: 'FinanceProof',
      entityId: proof.id,
      diff: {
        grantId: expenditure.grant.id,
        expenditureId: expenditure.id,
        filename: proof.filename,
        sizeBytes,
        byStaff: auth.isStaff,
      },
    },
  })

  return NextResponse.json(
    { id: proof.id, filename: proof.filename, shareToken: proof.shareToken },
    { status: 201 }
  )
}
