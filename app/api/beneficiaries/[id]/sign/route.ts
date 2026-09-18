import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { resolveProgrammeId } from '@/lib/scope'
import { tenantScope } from '@/lib/tenant-db'
import { hashAnswers, missingBeforeSigning, FIELD_LABELS } from '@/lib/beneficiary-form'
import { signatureImageSchema, signingContext } from '@/lib/signature'
import { canRead, canSign, type FormStatus } from '@/lib/beneficiary-access'

/**
 * POST /api/beneficiaries/[id]/sign
 *
 * The beneficiary signs. This is an ordinary electronic signature under the
 * Electronic Communications and Transactions Act: data attached to the record
 * with the intention of signing it.
 *
 * Four things are recorded together, and it is the combination that matters.
 * The typed name, which is the declaration. The drawn image, which is what the
 * funder expects to see printed. The circumstances - when, from where, with
 * what. And a hash of the exact answers at that moment, so that any later
 * alteration is detectable rather than invisible.
 *
 * The form is captured by staff with the beneficiary present, so the session
 * belongs to the person holding the device. The signature belongs to the
 * beneficiary, whose name is typed here and who does not need an account.
 */
const schema = z.object({
  signedName: z.string().trim().min(2).max(120),
  signatureImage: signatureImageSchema,
  /** The beneficiary's own confirmation, not a formality. */
  confirmed: z.literal(true),
})

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })
  }

  const scope = await tenantScope(session)
  if (!scope) return NextResponse.json({ error: 'No programme found' }, { status: 404 })
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope
  const record = await prisma.beneficiaryRecord.findFirst({
    where: { id: params.id, programmeId },
  })
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const actor = { userId: session.user.id, role: session.user.role }
  const shape = { userId: record.userId, status: record.status as FormStatus }

  if (!canRead(actor, shape)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (!canSign(actor, shape)) {
    return NextResponse.json(
      {
        error:
          record.status === 'Draft'
            ? 'You cannot sign this form.'
            : 'This form has already been signed.',
      },
      { status: 409 }
    )
  }

  // Nobody signs an incomplete form. A blank demographic is the single thing
  // that makes a funder report unusable, so it is caught here rather than
  // discovered at reporting time.
  const missing = missingBeforeSigning(record as unknown as Record<string, unknown>)
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: 'Complete the form before signing.',
        missing: missing.map((f) => FIELD_LABELS[f] ?? f),
      },
      { status: 422 }
    )
  }

  const { ip, ua } = signingContext(req.headers)

  await prisma.beneficiaryRecord.update({
    where: { id: record.id },
    data: {
      status: 'AwaitingAcceptance',
      beneficiarySignedName: parsed.data.signedName,
      beneficiarySignatureImage: parsed.data.signatureImage,
      beneficiarySignedAt: new Date(),
      beneficiarySignedIp: ip,
      beneficiarySignedUa: ua,
      beneficiarySignedHash: hashAnswers(record as unknown as Record<string, unknown>),
    },
  })

  await prisma.auditLog.create({
    data: {
      actorId: session.user.id,
      action: 'beneficiary.signed',
      entityType: 'BeneficiaryRecord',
      entityId: record.id,
      diff: { signedName: parsed.data.signedName, ip },
    },
  })

  return NextResponse.json({ ok: true })
}
