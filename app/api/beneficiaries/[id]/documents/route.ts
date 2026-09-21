import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { DocumentType } from '@prisma/client'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getS3, bucket, PRESIGN_TTL } from '@/lib/s3'
import { tenantScope } from '@/lib/tenant-db'
import { canEdit, type FormStatus } from '@/lib/beneficiary-access'
import {
  isAllowedUploadType,
  buildBeneficiaryDocumentKey,
  safeDisplayName,
  MAX_UPLOAD_BYTES,
} from '@/lib/uploads'

/**
 * Documents collected while a beneficiary form is being captured.
 *
 * POST - presigned PUT, to send the file to S3
 * PUT  - record it once it has landed
 *
 * This exists because there was nowhere to put an ID copy or a CIPC certificate
 * during onboarding. Documents could only hang off a participant, and a
 * beneficiary form produced no participant until acceptance started creating one -
 * so the moment when somebody is sitting there with their documents was the one
 * moment the platform could not accept them.
 *
 * Who may upload follows who may edit the form: the beneficiary while it is theirs
 * to fill in, and staff capturing one on somebody's behalf. Staff may also add one
 * after signing, because a certificate that arrives late is still the certificate,
 * and the signature covers the answers rather than the attachments.
 */

const presignSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  type: z.nativeEnum(DocumentType),
})

const recordSchema = presignSchema.extend({
  s3Key: z.string().min(1).max(500),
})

const STAFF = ['super_admin', 'facilitator']

/** The exact shape buildBeneficiaryDocumentKey produces. */
const KEY_PATTERN =
  /^beneficiaries\/[A-Za-z0-9_-]+\/documents\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/

async function authorise(
  session: Awaited<ReturnType<typeof getSession>>,
  recordId: string
) {
  if (!session) return { error: 'Unauthorized' as const, status: 401 }

  const scope = await tenantScope(session)
  if (!scope) return { error: 'Not found' as const, status: 404 }
  const { db: prisma } = scope

  const record = await prisma.beneficiaryRecord.findFirst({
    where: { id: recordId },
    select: { id: true, status: true, userId: true, innovatorId: true },
  })
  if (!record) return { error: 'Not found' as const, status: 404 }

  const isStaff = STAFF.includes(session.user.role)

  // A beneficiary may attach to their own form, and only while it is still theirs
  // to change. Staff are not bound by that: a certificate handed over after
  // signing is still that entity's certificate.
  if (!isStaff) {
    if (record.userId !== session.user.id) {
      return { error: 'Not found' as const, status: 404 }
    }
    if (
      !canEdit(
        { userId: session!.user.id, role: session!.user.role },
        { userId: record.userId, status: record.status as FormStatus }
      )
    ) {
      return {
        error: 'This form has been signed, so a facilitator has to add documents to it.' as const,
        status: 409,
      }
    }
  }

  return { prisma, record, actorId: session.user.id }
}

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
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

  const auth = await authorise(session, params.id)
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const s3Key = buildBeneficiaryDocumentKey(auth.record.id, randomUUID(), contentType)

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

export async function PUT(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const session = await getSession()

  const parsed = recordSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { filename, contentType, sizeBytes, s3Key, type } = parsed.data

  if (!isAllowedUploadType(contentType)) {
    return NextResponse.json({ error: 'That file type cannot be uploaded.' }, { status: 415 })
  }

  const auth = await authorise(session, params.id)
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const { prisma, record } = auth

  // The key has to be one this server issued, for this record. Without both
  // checks a caller could point a row at any object in the bucket.
  if (
    !KEY_PATTERN.test(s3Key) ||
    !s3Key.startsWith(`beneficiaries/${record.id}/documents/`)
  ) {
    return NextResponse.json({ error: 'Invalid storage key' }, { status: 400 })
  }

  const document = await prisma.document.create({
    data: {
      beneficiaryRecordId: record.id,
      // Set when the record has already been accepted, so the document lands in
      // the participant's vault immediately rather than waiting for a step that
      // has been and gone.
      innovatorId: record.innovatorId,
      type,
      name: safeDisplayName(filename),
      s3Key,
      sizeBytes,
      uploadedByUserId: auth.actorId,
    },
    select: { id: true, name: true, type: true },
  })

  await prisma.auditLog.create({
    data: {
      actorId: auth.actorId,
      action: 'beneficiary.document.uploaded',
      entityType: 'Document',
      entityId: document.id,
      diff: { beneficiaryRecordId: record.id, type, name: document.name, sizeBytes },
    },
  })

  return NextResponse.json(document, { status: 201 })
}
