import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { DocumentType } from '@prisma/client'

const schema = z.object({
  innovatorId: z.string().min(1),
  type: z.nativeEnum(DocumentType),
  name: z.string().min(1).max(255),
  s3Key: z.string().min(1),
  sizeBytes: z.number().int().positive(),
})

/** POST /api/documents — save document record after successful S3 upload */
export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const doc = await prisma.document.create({ data: parsed.data })
  return NextResponse.json(doc, { status: 201 })
}
