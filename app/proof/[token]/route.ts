import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getS3, bucket, PRESIGN_TTL } from '@/lib/s3'
import { safeDisplayName } from '@/lib/uploads'

/**
 * GET /proof/[token]
 *
 * Serves one piece of financial evidence to whoever holds the link.
 *
 * This route exists because of a hard constraint in the deliverable. The
 * exported workbook carries a link beside every transaction, and a funder opens
 * that workbook weeks or months after it is filed. A presigned S3 URL is
 * useless for that: they last five minutes here and cannot exceed seven days
 * under the signing protocol. The workbook would arrive full of dead links.
 *
 * So the link addresses the platform instead. The token is long and random,
 * the document is streamed via a short-lived redirect, and three things are
 * true that a shared drive link cannot offer: it can be revoked, every access
 * is counted, and the file never leaves the organisation's own storage.
 *
 * The trade is that anyone holding the URL can open that document. That is the
 * same property the drive links in the current workbook already have, and the
 * reason the token is 32 bytes rather than a database id.
 *
 * Deliberately unauthenticated. A funder has no account here, and requiring one
 * would defeat the purpose of putting the link in the file.
 */
export async function GET(_req: Request, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  // Reject anything that is not token-shaped before touching the database.
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(params.token)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const proof = await prisma.financeProof.findUnique({
    where: { shareToken: params.token },
    select: {
      id: true,
      s3Key: true,
      filename: true,
      contentType: true,
      revokedAt: true,
    },
  })

  // A revoked link and a link that never existed answer identically, so the
  // response cannot be used to confirm that a document once existed.
  if (!proof || proof.revokedAt) {
    return new NextResponse('Not found', { status: 404 })
  }

  // Best effort: an access log that fails must not stop the funder reading
  // their evidence.
  try {
    await prisma.financeProof.update({
      where: { id: proof.id },
      data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
    })
  } catch {
    // Recorded elsewhere by the platform's own logging.
  }

  const url = await getSignedUrl(
    getS3(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: proof.s3Key,
      // Force a download rather than letting storage render it. Nothing here
      // should ever execute in a browser against this origin.
      ResponseContentDisposition: `attachment; filename="${safeDisplayName(proof.filename)}"`,
      ResponseContentType: proof.contentType,
    }),
    { expiresIn: PRESIGN_TTL }
  )

  return NextResponse.redirect(url, {
    status: 302,
    headers: {
      // The redirect target is short-lived and per-request, so it must not be
      // cached anywhere between here and the reader.
      'Cache-Control': 'no-store, private',
      'Referrer-Policy': 'no-referrer',
    },
  })
}
