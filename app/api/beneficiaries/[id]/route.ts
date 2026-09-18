import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { encrypt, maskIdNumber } from '@/lib/encryption'
import { validateSAIdNumber } from '@/lib/utils'
import { resolveProgrammeId } from '@/lib/scope'
import { beneficiaryDraftSchema } from '@/lib/beneficiary-form'
import {
  canRead,
  canEdit,
  isStaff,
  isOwner,
  type FormStatus,
} from '@/lib/beneficiary-access'


/**
 * One capture form.
 *
 * The record is editable only while it is a Draft. Once the beneficiary has
 * signed, the answers are what they signed, and a signature over answers that
 * can still change afterwards evidences nothing.
 */

async function loadInScope(session: Awaited<ReturnType<typeof getSession>>, id: string) {
  const programmeId = await resolveProgrammeId(session!)
  if (!programmeId) return null
  return prisma.beneficiaryRecord.findFirst({ where: { id, programmeId } })
}

/** The shape the access rules need, from a loaded record. */
function actorAndRecord(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  record: { userId: string | null; status: string }
) {
  return {
    actor: { userId: session.user.id, role: session.user.role },
    record: { userId: record.userId, status: record.status as FormStatus },
  }
}

/** GET /api/beneficiaries/[id] */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const record = await loadInScope(session, params.id)
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { actor, record: shape } = actorAndRecord(session, record)
  if (!canRead(actor, shape)) {
    // The same 404 a missing record gives, so the response does not confirm
    // that somebody else's form exists.
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // The ID number never leaves the server in readable form. The last four
  // digits are enough to confirm the right person without revealing it.
  const { idNumberEncrypted, ...safe } = record

  return NextResponse.json({
    ...safe,
    idNumberMasked: idNumberEncrypted ? maskIdNumber('*************') : null,
    hasIdNumber: Boolean(idNumberEncrypted),
  })
}

/** PATCH /api/beneficiaries/[id] - edit a draft. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const record = await loadInScope(session, params.id)
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { actor, record: shape } = actorAndRecord(session, record)
  if (!canRead(actor, shape)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (!canEdit(actor, shape)) {
    return NextResponse.json(
      {
        error:
          record.status === 'Draft'
            ? 'You cannot edit this form.'
            : 'This form has been signed and can no longer be edited. It must be returned for correction first.',
      },
      { status: 409 }
    )
  }

  const parsed = beneficiaryDraftSchema.partial().safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })
  }

  const programmeId = record.programmeId
  const { cohortId, idNumber, ...rest } = parsed.data

  if (cohortId) {
    const cohort = await prisma.cohort.findFirst({
      where: { id: cohortId, programmeId },
      select: { id: true },
    })
    if (!cohort) {
      return NextResponse.json({ error: 'Cohort not found in your programme' }, { status: 403 })
    }
  }

  const data: Record<string, unknown> = { ...rest }
  if (cohortId !== undefined) data.cohortId = cohortId ?? null

  if (idNumber !== undefined) {
    if (idNumber === '') {
      data.idNumberEncrypted = null
    } else {
      if (!validateSAIdNumber(idNumber)) {
        return NextResponse.json({ error: 'Invalid SA ID number' }, { status: 400 })
      }
      data.idNumberEncrypted = encrypt(idNumber)
    }
  }

  await prisma.beneficiaryRecord.update({ where: { id: record.id }, data })
  return NextResponse.json({ ok: true })
}

/** DELETE /api/beneficiaries/[id] - withdraw. Never a hard delete once signed. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const record = await loadInScope(session, params.id)
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { actor, record: shape } = actorAndRecord(session, record)
  if (!canRead(actor, shape)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  // A beneficiary may abandon their own unsigned draft. Once signed, only
  // staff decide what happens to it.
  if (!isStaff(actor.role) && !(isOwner(actor, shape) && record.status === 'Draft')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (record.status === 'Accepted') {
    return NextResponse.json(
      { error: 'An accepted form is part of the funder record and cannot be withdrawn.' },
      { status: 409 }
    )
  }

  // An unsigned draft is removed outright; a signed one is marked withdrawn so
  // the signature and its circumstances survive.
  if (record.status === 'Draft') {
    await prisma.beneficiaryRecord.delete({ where: { id: record.id } })
  } else {
    await prisma.beneficiaryRecord.update({
      where: { id: record.id },
      data: { status: 'Withdrawn' },
    })
  }

  return NextResponse.json({ ok: true })
}
