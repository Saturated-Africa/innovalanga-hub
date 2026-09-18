import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getS3, bucket, PRESIGN_TTL } from '@/lib/s3'
import { tenantScope } from '@/lib/tenant-db'
import { safeDisplayName } from '@/lib/uploads'

/**
 * Both handlers had a role gate and no scope whatsoever: any facilitator could
 * read or delete any document belonging to any programme by id. Documents carry
 * no programme of their own, so the scope runs through the innovator's cohort.
 */

/** DELETE /api/documents/[id] - remove the record and the stored object. */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope

  const doc = await prisma.document.findFirst({
    where: { id: params.id, innovator: { cohort: { programmeId } } },
    select: { id: true, s3Key: true },
  })
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Delete from S3 (best-effort)
  try {
    await getS3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: doc.s3Key }))
  } catch {
    // Non-fatal - still remove the DB record
  }

  await prisma.document.delete({ where: { id: doc.id } })
  return NextResponse.json({ ok: true })
}

/** GET /api/documents/[id] - return a presigned download URL. */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope

  const doc = await prisma.document.findFirst({
    where: { id: params.id, innovator: { cohort: { programmeId } } },
    select: { s3Key: true, name: true },
  })
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const url = await getSignedUrl(
    getS3(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: doc.s3Key,
      // Force a download rather than letting S3 render the object inline. Even
      // with the upload allowlist in place, nothing stored here should ever
      // execute in the browser against this origin.
      ResponseContentDisposition: `attachment; filename="${safeDisplayName(doc.name)}"`,
    }),
    { expiresIn: PRESIGN_TTL }
  )

  return NextResponse.json({ url })
}
