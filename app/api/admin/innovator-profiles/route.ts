import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { encrypt } from '@/lib/encryption'
import { validateSAIdNumber } from '@/lib/utils'

const schema = z.object({
  userId: z.string().min(1),
  cohortId: z.string().min(1),
  regionId: z.string().optional(),
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  phone: z.string().optional(),
  idNumber: z.string().length(13).optional(),
  businessName: z.string().max(100).optional(),
  businessSector: z.string().max(100).optional(),
  bio: z.string().max(500).optional(),
})

export async function POST(req: Request) {
  const session = await getSession()
  if (!session || !['super_admin', 'facilitator'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })
  }

  const { userId, idNumber, ...rest } = parsed.data

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (user.role !== 'innovator') {
    return NextResponse.json({ error: 'User is not an innovator' }, { status: 400 })
  }

  const existing = await prisma.innovatorProfile.findUnique({ where: { userId } })
  if (existing) {
    return NextResponse.json({ error: 'Profile already exists for this user' }, { status: 409 })
  }

  let idNumberEncrypted: string | null = null
  if (idNumber) {
    if (!validateSAIdNumber(idNumber)) {
      return NextResponse.json({ error: 'Invalid SA ID number' }, { status: 400 })
    }
    idNumberEncrypted = encrypt(idNumber)
  }

  const profile = await prisma.innovatorProfile.create({
    data: {
      userId,
      idNumberEncrypted,
      ...rest,
    },
  })

  return NextResponse.json(profile, { status: 201 })
}
