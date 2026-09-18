import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getS3, bucket, PRESIGN_TTL } from '@/lib/s3'
import { randomUUID } from 'crypto'
import { tenantScope } from '@/lib/tenant-db'
import { innovatorInProgramme } from '@/lib/authz'
import {
  isAllowedUploadType,
  buildDocumentKey,
  MAX_UPLOAD_BYTES,
} from '@/lib/uploads'

/**
 * POST /api/documents/upload-url - presigned S3 PUT for a programme document.
 *
 * Three things were wrong here. The route accepted any `contentType`, so HTML
 * or SVG could be stored and later served as active content from the same
 * origin as document downloads. The stored extension came from the client's
 * filename, so the object name could disagree with its approved type. And the
 * innovator id was never checked against the caller's programme, so a
 * facilitator could write into another funder's folder.
 */
const schema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  innovatorId: z.string().min(1),
  /** Client-declared size, bound at presign time by ContentLength below. */
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
})

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })
  }

  const { contentType, innovatorId, sizeBytes } = parsed.data

  if (!isAllowedUploadType(contentType)) {
    return NextResponse.json(
      { error: 'That file type cannot be uploaded.' },
      { status: 415 }
    )
  }

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  if (!(await innovatorInProgramme(innovatorId, programmeId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // The key is composed from the authorised innovator id, a random id and an
  // extension taken from the allowlist. The client's filename is not used.
  const s3Key = buildDocumentKey(innovatorId, randomUUID(), contentType)

  const url = await getSignedUrl(
    getS3(),
    new PutObjectCommand({
      Bucket: bucket(),
      Key: s3Key,
      ContentType: contentType,
      // Signing the length means the presigned URL cannot be reused to upload
      // a body of a different size.
      ContentLength: sizeBytes,
    }),
    { expiresIn: PRESIGN_TTL }
  )

  return NextResponse.json({ url, s3Key })
}
