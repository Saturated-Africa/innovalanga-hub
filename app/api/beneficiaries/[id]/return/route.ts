import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { resolveProgrammeId } from '@/lib/scope'
import { tenantScope } from '@/lib/tenant-db'
import { canReturn, type FormStatus } from '@/lib/beneficiary-access'

/**
 * POST /api/beneficiaries/[id]/return
 *
 * Send a submitted form back to the beneficiary for correction.
 *
 * This exists because the alternative is worse. Once a form is signed the
 * answers are frozen, so a facilitator who spots a wrong ID number has only two
 * options without this: approve something they know is wrong, or discard the
 * submission and make the person start again. Returning it reopens the draft.
 *
 * Returning **voids the signature**. Every signature column is cleared, because
 * the answers are about to change and a signature that survives an edit is
 * evidence of nothing. The beneficiary signs again once they have corrected it,
 * which is the honest outcome rather than a convenient one.
 */
const schema = z.object({
  reason: z.string().trim().min(3).max(1000),
})

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'A reason is required so the beneficiary knows what to fix.' },
      { status: 400 }
    )
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

  if (!canReturn(actor, shape)) {
    return NextResponse.json(
      {
        error:
          record.status === 'AwaitingAcceptance'
            ? 'You cannot return this form.'
            : 'Only a submitted form can be returned.',
      },
      { status: 409 }
    )
  }

  await prisma.beneficiaryRecord.update({
    where: { id: record.id },
    data: {
      status: 'Draft',
      returnedAt: new Date(),
      returnedReason: parsed.data.reason,
      // The signature is voided in full. Leaving the image behind while the
      // answers change would put a picture of a signature next to text the
      // person never agreed to.
      beneficiarySignedName: null,
      beneficiarySignedAt: null,
      beneficiarySignedIp: null,
      beneficiarySignedUa: null,
      beneficiarySignatureImage: null,
      beneficiarySignedHash: null,
    },
  })

  await prisma.auditLog.create({
    data: {
      actorId: session.user.id,
      action: 'beneficiary.returned',
      entityType: 'BeneficiaryRecord',
      entityId: record.id,
      diff: { reason: parsed.data.reason, signatureVoided: true },
    },
  })

  return NextResponse.json({ ok: true })
}
