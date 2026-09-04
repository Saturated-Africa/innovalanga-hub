import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getS3, bucket, PRESIGN_TTL } from '@/lib/s3'

/** DELETE /api/documents/[id] — remove document record and S3 object */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const doc = await prisma.document.findUnique({ where: { id: params.id } })
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Delete from S3 (best-effort)
  try {
    await getS3().send(
      new DeleteObjectCommand({ Bucket: bucket(), Key: doc.s3Key })
    )
  } catch {
    // Non-fatal — still remove the DB record
  }

  await prisma.document.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}

/** GET /api/documents/[id] — return a presigned download URL */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const doc = await prisma.document.findUnique({ where: { id: params.id } })
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const url = await getSignedUrl(
    getS3(),
    new GetObjectCommand({ Bucket: bucket(), Key: doc.s3Key }),
    { expiresIn: PRESIGN_TTL }
  )

  return NextResponse.json({ url })
}
