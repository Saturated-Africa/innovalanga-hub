import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { resolveProgrammeId } from '@/lib/scope'
import { tenantScope } from '@/lib/tenant-db'
import { hashAnswers } from '@/lib/beneficiary-form'
import { signatureImageSchema, signingContext } from '@/lib/signature'
import { canApprove, type FormStatus } from '@/lib/beneficiary-access'
import { canLink, profileFromRecord } from '@/lib/beneficiary-link'
import { generateTempPassword } from '@/lib/temp-password'
import bcrypt from 'bcryptjs'

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
 *
 * Accepting also makes the person a participant, which it did not do before. The
 * record's own comment always said `innovatorId` is "set when the record is
 * accepted", and nothing ever set it - so onboarding produced signed, accepted
 * forms that no assessment, booking, stipend or grant could attach to, because
 * none of those hang off a beneficiary record. They hang off an InnovatorProfile.
 *
 * The acceptance and the profile are written in one transaction. Half of this
 * happening is the worst outcome: a form marked accepted with no participant
 * behind it looks finished from every screen while being useless.
 */
const schema = z.object({
  acceptedByName: z.string().trim().min(2).max(120),
  signatureImage: signatureImageSchema,
  confirmed: z.literal(true),
})

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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

  /*
   * Who this person will be on the platform.
   *
   * A beneficiary who filled the form in themselves already has an account, and
   * that account becomes the participant rather than a second one being created.
   * Otherwise the email is checked: an address already belonging to a participant
   * means this person was probably captured twice, and creating a second profile
   * would split their assessments across both.
   */
  // The account this record belongs to, if any. Looked up by id when the
  // beneficiary filled the form in themselves, otherwise by email.
  //
  // It has to be this account's profile that is checked, not merely one matching
  // the email. InnovatorProfile.userId is unique, so a self-completed form whose
  // account is already a participant would otherwise fail on a constraint
  // violation instead of a sentence somebody can act on.
  const account = record.userId
    ? await prisma.user.findUnique({
        where: { id: record.userId },
        select: { id: true, innovatorProfile: { select: { id: true } } },
      })
    : await prisma.user.findUnique({
        where: { email: record.email },
        select: { id: true, innovatorProfile: { select: { id: true } } },
      })

  const accountUserId = account?.id ?? null
  const verdict = canLink(
    { innovatorId: record.innovatorId, cohortId: record.cohortId, fullName: record.fullName },
    {
      userId: accountUserId,
      hasInnovatorProfile: Boolean(account?.innovatorProfile),
    }
  )
  if (!verdict.allowed) {
    return NextResponse.json({ error: verdict.reason, block: verdict.block }, { status: 409 })
  }

  const fields = profileFromRecord(record)
  // Only minted when an account has to be created. Returned once, never stored
  // in readable form, and the account can change it from its own account page.
  const tempPassword = accountUserId ? null : generateTempPassword()
  const hashed = tempPassword ? await bcrypt.hash(tempPassword, 12) : null

  const linked = await prisma.$transaction(async (tx) => {
    const userId =
      accountUserId ??
      (
        await tx.user.create({
          data: {
            email: record.email,
            name: `${fields.firstName} ${fields.lastName}`.trim(),
            password: hashed,
            role: 'innovator',
            programmeId,
          },
          select: { id: true },
        })
      ).id

    const profile = await tx.innovatorProfile.create({
      data: {
        userId,
        // Non-null by the time canLink has allowed this.
        cohortId: record.cohortId as string,
        firstName: fields.firstName,
        lastName: fields.lastName,
        phone: fields.phone,
        businessName: fields.businessName,
        businessSector: fields.businessSector,
        bio: fields.bio,
        // Carried across as ciphertext. There is no reason to decrypt an ID
        // number in order to copy it, and not decrypting means this path cannot
        // leak one into a log or a stack trace.
        idNumberEncrypted: fields.idNumberEncrypted,
      },
      select: { id: true, firstName: true, lastName: true },
    })

    /*
     * Documents collected against the form now belong to the participant too.
     *
     * The beneficiary link is kept rather than moved: it is the provenance - this
     * ID copy was handed over at onboarding, against this form - and the added
     * innovatorId is what makes it appear in the participant's vault. Without this
     * step the certificate would sit in storage, attached to a record nobody looks
     * at again, and a facilitator would ask for it a second time.
     */
    await tx.document.updateMany({
      where: { beneficiaryRecordId: record.id, innovatorId: null },
      data: { innovatorId: profile.id },
    })

    await tx.beneficiaryRecord.update({
      where: { id: record.id },
      data: {
        status: 'Accepted',
        acceptedByName: parsed.data.acceptedByName,
        acceptedByUserId: session.user.id,
        acceptanceSignatureImage: parsed.data.signatureImage,
        acceptedAt: new Date(),
        acceptedIp: ip,
        acceptedUa: ua,
        innovatorId: profile.id,
      },
    })

    return { profile, userId }
  })

  await prisma.auditLog.create({
    data: {
      innovatorId: linked.profile.id,
      actorId: session.user.id,
      action: 'beneficiary.accepted',
      entityType: 'BeneficiaryRecord',
      entityId: record.id,
      diff: {
        acceptedByName: parsed.data.acceptedByName,
        ip,
        innovatorId: linked.profile.id,
        // That an account was created is worth keeping; the password is not
        // written here or anywhere else.
        accountCreated: tempPassword !== null,
      },
    },
  })

  return NextResponse.json({
    ok: true,
    participant: {
      id: linked.profile.id,
      name: `${linked.profile.firstName} ${linked.profile.lastName}`.trim(),
    },
    // Shown once so the facilitator can hand it over. There is no way to read it
    // again, because it is stored only as a bcrypt hash.
    temporaryPassword: tempPassword,
    email: record.email,
  })
}
