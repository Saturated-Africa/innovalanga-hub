import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { systemPrisma } from '@/lib/prisma'
import { decrypt } from '@/lib/encryption'
import { deriveFromIdNumber } from '@/lib/beneficiary-form'

/**
 * POST /api/admin/backfill/beneficiary-dob
 *
 * One-off: fill in the date of birth for records captured before it was stored.
 *
 * A route rather than a script, for one reason: decryption uses scrypt with a
 * per-value salt, and reimplementing that in a standalone script means matching
 * the parameters exactly or silently producing rubbish. Running inside the app
 * uses the same `decrypt` everything else uses, with the key the app already has.
 * The container ships the built application and not `scripts/`, so a script would
 * have needed a second copy of the crypto to run at all.
 *
 * Safe to run repeatedly. It only touches rows where the date is null and an
 * encrypted ID exists, so a second run finds nothing to do. It can be deleted
 * once every environment has been backfilled; leaving it costs a guarded endpoint
 * that does nothing.
 *
 * Batched deliberately. Each row costs one scrypt derivation, which is expensive
 * on purpose, so a whole table in one request would time out halfway and leave
 * nobody sure how far it got. The response says whether more remain.
 *
 * Runs on the owning connection. A backfill is a platform maintenance job across
 * every programme, and the caller is a platform administrator - this is exactly
 * the case that connection exists for.
 */
const schema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  /** Report what would change without writing anything. */
  dryRun: z.boolean().optional(),
})

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const limit = parsed.data.limit ?? 100
  const dryRun = parsed.data.dryRun ?? false

  const candidates = await systemPrisma.beneficiaryRecord.findMany({
    where: { dateOfBirth: null, idNumberEncrypted: { not: null } },
    select: { id: true, idNumberEncrypted: true },
    take: limit,
    orderBy: { createdAt: 'asc' },
  })

  let updated = 0
  let undecryptable = 0
  let unparseable = 0

  for (const row of candidates) {
    let idNumber: string
    try {
      idNumber = decrypt(row.idNumberEncrypted as string)
    } catch {
      // A value written under a key that has since changed, or by an older
      // scheme. Counted and skipped: there is nothing to derive, and failing the
      // whole batch over one row would make the job unrunnable.
      undecryptable += 1
      continue
    }

    const derived = deriveFromIdNumber(idNumber)
    if (!derived) {
      // Thirteen digits that are not a date. Left alone rather than guessed at.
      unparseable += 1
      continue
    }

    if (!dryRun) {
      await systemPrisma.beneficiaryRecord.update({
        where: { id: row.id },
        data: { dateOfBirth: derived.dateOfBirth },
      })
    }
    updated += 1
  }

  const remaining = await systemPrisma.beneficiaryRecord.count({
    where: { dateOfBirth: null, idNumberEncrypted: { not: null } },
  })

  // Logged as a count, never as a value. The point of the exercise is to stop
  // handling ID numbers, so none of them appear here.
  await systemPrisma.auditLog.create({
    data: {
      actorId: session.user.id,
      action: 'admin.backfill.beneficiaryDateOfBirth',
      entityType: 'BeneficiaryRecord',
      entityId: 'batch',
      diff: { examined: candidates.length, updated, undecryptable, unparseable, dryRun },
    },
  })

  return NextResponse.json({
    examined: candidates.length,
    updated,
    undecryptable,
    unparseable,
    /**
     * Counted after the writes, so on a real run this is what is genuinely left.
     * On a dry run nothing was written, so it still includes the rows this call
     * reported as updatable.
     */
    remaining,
    dryRun,
    note: dryRun
      ? 'Nothing was written. "remaining" still includes the rows above.'
      : remaining > 0
        ? 'More records remain. Run this again; it is safe to repeat.'
        : 'Nothing left to backfill.',
  })
}
