import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { generateTempPassword } from '@/lib/temp-password'
import { randomBytes } from 'crypto'
import { encrypt } from '@/lib/encryption'
import { validateSAIdNumber } from '@/lib/utils'
import { tenantScope } from '@/lib/tenant-db'

/**
 * POST /api/admin/innovators - create an innovator account and profile together.
 *
 * The Innovators page has always carried an "Add Innovator" button pointing at
 * /dashboard/innovators/new, and that route did not exist. The only way to
 * onboard anyone was for them to self-register and then for a super_admin to
 * complete their profile from the admin area, which facilitators cannot reach.
 * So the primary role responsible for participants had no path at all.
 *
 * This creates both records in one transaction and returns a one-time password
 * for the facilitator to hand over. It does not email anything: the sending
 * domain is not verified yet, and a credential that silently fails to arrive is
 * worse than one shown on screen.
 */
const schema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  cohortId: z.string().min(1),
  regionId: z.string().optional(),
  phone: z.string().max(20).optional(),
  idNumber: z.string().length(13).optional(),
  businessName: z.string().max(100).optional(),
  businessSector: z.string().max(100).optional(),
  bio: z.string().max(500).optional(),
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

  const { email, idNumber, cohortId, regionId, ...rest } = parsed.data

  const scope = await tenantScope(session)
  if (!scope) {
    return NextResponse.json({ error: 'No programme found' }, { status: 404 })
  }
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope

  // The cohort is client-supplied, so it is checked against the caller's
  // programme rather than trusted. Without this a facilitator could place a
  // participant into another funder's cohort.
  const cohort = await prisma.cohort.findFirst({
    where: { id: cohortId, programmeId },
    select: { id: true },
  })
  if (!cohort) {
    return NextResponse.json({ error: 'Cohort not found in your programme' }, { status: 403 })
  }

  if (regionId) {
    const region = await prisma.region.findFirst({
      where: { id: regionId, programmeId },
      select: { id: true },
    })
    if (!region) {
      return NextResponse.json({ error: 'Region not found in your programme' }, { status: 403 })
    }
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (existing) {
    return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 })
  }

  let idNumberEncrypted: string | null = null
  if (idNumber) {
    if (!validateSAIdNumber(idNumber)) {
      return NextResponse.json({ error: 'Invalid SA ID number' }, { status: 400 })
    }
    idNumberEncrypted = encrypt(idNumber)
  }

  const tempPassword = generateTempPassword()
  const hashed = await bcrypt.hash(tempPassword, 12)

  const profile = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name: `${rest.firstName} ${rest.lastName}`,
        password: hashed,
        role: 'innovator',
        // Self-registration leaves this null, which makes the account fall back
        // to the first programme on the platform. Admin-created accounts are
        // pinned to the creator's programme from the start.
        programmeId,
      },
      select: { id: true },
    })

    return tx.innovatorProfile.create({
      data: {
        userId: user.id,
        cohortId,
        regionId: regionId || null,
        idNumberEncrypted,
        ...rest,
      },
      select: { id: true },
    })
  })

  return NextResponse.json(
    { id: profile.id, email, tempPassword },
    { status: 201 }
  )
}
