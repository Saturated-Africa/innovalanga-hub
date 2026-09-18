import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getS3, bucket, PRESIGN_TTL } from '@/lib/s3'
import { randomUUID } from 'crypto'
import { tenantScope } from '@/lib/tenant-db'
import { isAllowedUploadType, buildFinanceProofKey, MAX_UPLOAD_BYTES } from '@/lib/uploads'

/**
 * POST /api/finance/proofs/upload-url
 *
 * Presigned PUT for an invoice, proof of payment or bank statement.
 *
 * Same rules as every other upload here: the content type must be on the
 * allowlist, the extension comes from that allowlist rather than the filename,
 * the length is signed so the URL cannot be reused for a different body, and
 * the key is built entirely from values the server decided.
 */
const schema = z.object({
  projectId: z.string().min(1),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
})

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

  const { projectId, contentType, sizeBytes } = parsed.data

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

  const s3Key = buildFinanceProofKey(project.id, randomUUID(), contentType)

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
