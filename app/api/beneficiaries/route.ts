import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { encrypt } from '@/lib/encryption'
import { validateSAIdNumber } from '@/lib/utils'
import { tenantScope } from '@/lib/tenant-db'
import { beneficiaryDraftSchema, resolveDateOfBirth } from '@/lib/beneficiary-form'
import { checkRegistration, type EntityKind } from '@/lib/company-registration'
import { isStaff } from '@/lib/beneficiary-access'

/**
 * Beneficiary capture forms.
 *
 * Capturing is a staff activity: the form is completed with the beneficiary
 * present and signed on the spot, which is how the paper version is used. The
 * beneficiary does not need an account to sign, and usually does not have one
 * yet, so nothing here assumes a participant record exists.
 */

/**
 * GET /api/beneficiaries
 *
 * Staff see every form in their programme. A beneficiary sees only their own,
 * which is the same query with one extra clause rather than a separate route
 * that could forget it.
 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'No programme found' }, { status: 404 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope

  const mine = isStaff(session.user.role) ? {} : { userId: session.user.id }

  const records = await prisma.beneficiaryRecord.findMany({
    where: { programmeId, ...mine },
    orderBy: { createdAt: 'desc' },
    // No ID number, no signature images. A list does not need either, and the
    // encrypted column has no business leaving the server at all.
    select: {
      id: true,
      fullName: true,
      email: true,
      status: true,
      projectTitle: true,
      createdAt: true,
      beneficiarySignedAt: true,
      acceptedAt: true,
      cohort: { select: { id: true, name: true } },
    },
  })

  return NextResponse.json(records)
}

/**
 * POST /api/beneficiaries - start a form.
 *
 * A beneficiary starts their own, and the record is stamped with their account
 * so ownership is decided here rather than inferred later. Staff start one on
 * behalf of somebody being onboarded in person, which leaves no owner.
 */
export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = beneficiaryDraftSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })
  }

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'No programme found' }, { status: 404 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope

  const { cohortId, idNumber, entityRegistrationNumber, entityType, ...rest } = parsed.data
  /*
   * The registration number is checked against the entity type.
   *
   * The last two digits of a CIPC number say what kind of entity it is, so a
   * number ending /07 against an entity type of NPC means one of the two was
   * mistyped. Refused rather than corrected: the type decides how the
   * organisation appears in a funder's report, and the number is what a funder
   * uses to look it up.
   *
   * Stored normalised, so two records for the same entity match - a certificate
   * written CK1998/012345/23 and one written 1998/012345/23 are the same company.
   */
  let registrationNumber: string | null = null
  if (entityRegistrationNumber && entityRegistrationNumber.trim() !== '') {
    const verdict = checkRegistration(
      entityRegistrationNumber,
      (entityType ?? 'Other') as EntityKind
    )
    if (!verdict.ok) {
      return NextResponse.json({ error: verdict.error }, { status: 400 })
    }
    registrationNumber = verdict.normalised ?? null
  }


  // A client-supplied cohort is checked against the caller's programme.
  if (cohortId) {
    const cohort = await prisma.cohort.findFirst({
      where: { id: cohortId, programmeId },
      select: { id: true },
    })
    if (!cohort) {
      return NextResponse.json({ error: 'Cohort not found in your programme' }, { status: 403 })
    }
  }

  let idNumberEncrypted: string | null = null
  if (idNumber) {
    if (!validateSAIdNumber(idNumber)) {
      return NextResponse.json({ error: 'Invalid SA ID number' }, { status: 400 })
    }
    idNumberEncrypted = encrypt(idNumber)
  }

  /*
   * The date of birth: what was typed, or what the ID number implies.
   *
   * Settled here because this is the only point in the record's life where the
   * plaintext ID is in hand. Deriving it later would mean decrypting - and, to
   * count youth across a cohort, decrypting every ID in it to produce one
   * integer. A stored date answers the question a funder actually asks without
   * keeping a room full of ID numbers available to answer it.
   *
   * A disagreement between the two is refused rather than resolved silently: one
   * of them is mistyped, and one of them is an identity number.
   */
  const { dateOfBirth: typedDob, ...recordFields } = rest as typeof rest & {
    dateOfBirth?: string
  }
  const dob = resolveDateOfBirth({ typed: typedDob, idNumber })
  if (!dob.ok) {
    return NextResponse.json({ error: dob.error }, { status: 400 })
  }
  const dateOfBirth = dob.dateOfBirth

  const ownedByCaller = !isStaff(session.user.role)

  try {
    const record = await prisma.beneficiaryRecord.create({
      data: {
        ...recordFields,
        entityType: entityType ?? null,
        entityRegistrationNumber: registrationNumber,
        programmeId,
        cohortId: cohortId ?? null,
        idNumberEncrypted,
        dateOfBirth,
        userId: ownedByCaller ? session.user.id : null,
        capturedByUserId: session.user.id,
      },
      select: { id: true, fullName: true, status: true },
    })
    return NextResponse.json(record, { status: 201 })
  } catch (err) {
    // The unique index on (programmeId, userId) is what stops a beneficiary
    // holding two forms. Reported as a conflict rather than a server error.
    if ((err as { code?: string }).code === 'P2002') {
      return NextResponse.json(
        { error: 'You already have a beneficiary form for this programme.' },
        { status: 409 }
      )
    }
    throw err
  }
}
