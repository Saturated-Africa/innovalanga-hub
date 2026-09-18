import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { DocumentType } from '@prisma/client'
import { tenantScope } from '@/lib/tenant-db'
import { innovatorInProgramme } from '@/lib/authz'
import { safeDisplayName, MAX_UPLOAD_BYTES } from '@/lib/uploads'

/**
 * POST /api/documents - record a document after a successful S3 upload.
 *
 * `s3Key` used to be supplied by the client and stored verbatim, and the
 * download route later presigns whatever key the row holds. Any key in the
 * bucket could therefore be named here and then read back through a legitimate
 * download link - including another programme's documents.
 *
 * The key is now derived from the presign step instead of trusted: it must
 * match the shape that step produces, and the innovator segment inside it must
 * be the innovator the caller is authorised for.
 */
const schema = z.object({
  innovatorId: z.string().min(1),
  type: z.nativeEnum(DocumentType),
  name: z.string().min(1).max(255),
  s3Key: z.string().min(1).max(500),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
})

/** The exact shape `buildDocumentKey` produces. Anything else is rejected. */
const KEY_PATTERN =
  /^innovators\/[A-Za-z0-9_-]+\/documents\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/

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

  const { innovatorId, s3Key, name, ...rest } = parsed.data

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  if (!(await innovatorInProgramme(innovatorId, programmeId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!KEY_PATTERN.test(s3Key)) {
    return NextResponse.json({ error: 'Invalid storage key' }, { status: 400 })
  }

  // The key must belong to the innovator we just authorised, not merely look
  // well formed.
  if (!s3Key.startsWith(`innovators/${innovatorId}/documents/`)) {
    return NextResponse.json({ error: 'Storage key does not match innovator' }, { status: 400 })
  }

  const doc = await prisma.document.create({
    data: {
      ...rest,
      innovatorId,
      s3Key,
      name: safeDisplayName(name),
    },
  })

  return NextResponse.json(doc, { status: 201 })
}
