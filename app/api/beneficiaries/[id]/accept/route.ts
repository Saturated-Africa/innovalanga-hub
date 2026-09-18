import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { resolveProgrammeId } from '@/lib/scope'
import { tenantScope } from '@/lib/tenant-db'
import { hashAnswers } from '@/lib/beneficiary-form'
import { signatureImageSchema, signingContext } from '@/lib/signature'
import { canApprove, type FormStatus } from '@/lib/beneficiary-access'

/**
 * POST /api/beneficiaries/[id]/accept
 *
 * The centre's counter-signature, matching the "Acceptance by STE Centre" block
 * at the foot of the paper form.
 *
 * Before accepting, the answers are hashed again and compared against the hash
 * taken when the beneficiary signed. If they differ, something changed between
 * the two signatures and the acceptance is refused. Without that check the
 * hash would be a stored value nobody ever reads, which is the usual fate of
 * integrity fields.
 */
const schema = z.object({
  acceptedByName: z.string().trim().min(2).max(120),
  signatureImage: signatureImageSchema,
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

  if (!canApprove(actor, shape)) {
    if (record.status === 'Accepted') {
      return NextResponse.json({ error: 'This form has already been accepted.' }, { status: 409 })
    }
    if (record.status !== 'AwaitingAcceptance') {
      return NextResponse.json(
        { error: 'The beneficiary has not signed this form yet.' },
        { status: 409 }
      )
    }
    // Staff, signed, but it is the approver's own form. The acceptance block is
    // a counter-signature; approving a form about yourself is not one.
    return NextResponse.json(
      { error: 'This form cannot be approved by the person it describes.' },
      { status: 403 }
    )
  }

  // The integrity check that gives the stored hash a purpose.
  const currentHash = hashAnswers(record as unknown as Record<string, unknown>)
  if (record.beneficiarySignedHash && currentHash !== record.beneficiarySignedHash) {
    return NextResponse.json(
      {
        error:
          'The answers have changed since the beneficiary signed. This form cannot be accepted. Withdraw it and capture a fresh one.',
      },
      { status: 409 }
    )
  }

  const { ip, ua } = signingContext(req.headers)

  await prisma.beneficiaryRecord.update({
    where: { id: record.id },
    data: {
      status: 'Accepted',
      acceptedByName: parsed.data.acceptedByName,
      acceptedByUserId: session.user.id,
      acceptanceSignatureImage: parsed.data.signatureImage,
      acceptedAt: new Date(),
      acceptedIp: ip,
      acceptedUa: ua,
    },
  })

  await prisma.auditLog.create({
    data: {
      actorId: session.user.id,
      action: 'beneficiary.accepted',
      entityType: 'BeneficiaryRecord',
      entityId: record.id,
      diff: { acceptedByName: parsed.data.acceptedByName, ip },
    },
  })

  return NextResponse.json({ ok: true })
}
