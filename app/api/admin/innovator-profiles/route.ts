import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { encrypt } from '@/lib/encryption'
import { validateSAIdNumber } from '@/lib/utils'
import { tenantScope } from '@/lib/tenant-db'

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

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'No programme found' }, { status: 404 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (user.role !== 'innovator') {
    return NextResponse.json({ error: 'User is not an innovator' }, { status: 400 })
  }

  // The cohort is client-supplied and decides which programme this participant
  // belongs to. Unchecked, a facilitator on one funder's programme could enrol
  // somebody straight into another funder's cohort, where they would then
  // appear in that funder's reporting and stipend register.
  const cohort = await prisma.cohort.findFirst({
    where: { id: rest.cohortId, programmeId },
    select: { id: true },
  })
  if (!cohort) {
    return NextResponse.json({ error: 'That cohort is not in your programme.' }, { status: 403 })
  }

  // A region, where given, has to belong to the same programme as the cohort.
  if (rest.regionId) {
    const region = await prisma.region.findFirst({
      where: { id: rest.regionId, programmeId },
      select: { id: true },
    })
    if (!region) {
      return NextResponse.json({ error: 'That region is not in your programme.' }, { status: 403 })
    }
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
    // Explicit select. Returning the created row wholesale handed the client
    // back `idNumberEncrypted` - the encrypted SA ID number - along with the
    // phone number, neither of which the caller needs to see the record was
    // created.
    select: {
      id: true,
      firstName: true,
      lastName: true,
      cohortId: true,
      regionId: true,
      businessName: true,
      businessSector: true,
      createdAt: true,
    },
  })

  return NextResponse.json(profile, { status: 201 })
}
