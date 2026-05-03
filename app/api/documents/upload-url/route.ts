import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import AWS from 'aws-sdk'
import { randomUUID } from 'crypto'

const schema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1),
  innovatorId: z.string().min(1),
})

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION ?? 'af-south-1',
  signatureVersion: 'v4',
})

/** POST /api/documents/upload-url — returns a presigned S3 PUT URL */
export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const { filename, contentType, innovatorId } = parsed.data
  const ext = filename.split('.').pop() ?? 'bin'
  const s3Key = `innovators/${innovatorId}/documents/${randomUUID()}.${ext}`

  const url = s3.getSignedUrl('putObject', {
    Bucket: process.env.AWS_S3_BUCKET,
    Key: s3Key,
    ContentType: contentType,
    Expires: 300, // 5 minutes
  })

  return NextResponse.json({ url, s3Key })
}
