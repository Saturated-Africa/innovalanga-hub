import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { systemPrisma } from '@/lib/prisma'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { checkPassword, MAX_LENGTH } from '@/lib/password-policy'
import { checkRateLimit, clearRateLimit, clientIp, type RateLimitRule } from '@/lib/rate-limit'

/**
 * POST /api/account/password
 *
 * Change your own password. Not anybody else's - there is no id in this route,
 * deliberately, so it cannot become a way to set another person's password.
 *
 * The current password is required even though the caller is already signed in.
 * A session cookie is something an unattended laptop hands to whoever sits down
 * at it; the current password is something only the account holder knows. The
 * cost is one extra field and it turns a walk-past into a dead end.
 *
 * Runs on the owning connection because an account is not a programme's
 * property. It belongs to the person, who may be a platform administrator with
 * no programme at all.
 */
const schema = z.object({
  currentPassword: z.string().min(1).max(MAX_LENGTH),
  newPassword: z.string().min(1).max(MAX_LENGTH),
})

/**
 * Attempts are limited per account, not per address.
 *
 * The thing being guarded is somebody guessing the current password of one
 * account while sitting in front of it. Limiting by address would let an
 * attacker who moves network do the same thing, and would let one person on a
 * shared office connection lock out a colleague.
 */
const CHANGE_PASSWORD: RateLimitRule = {
  limit: 5,
  windowMs: 15 * 60 * 1000,
  lockoutMs: 15 * 60 * 1000,
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Fill in both fields.' }, { status: 400 })
  }
  const { currentPassword, newPassword } = parsed.data

  const key = `password-change:${session.user.id}`
  const limit = checkRateLimit(key, CHANGE_PASSWORD)
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`,
      },
      { status: 429 }
    )
  }

  const user = await systemPrisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, password: true },
  })
  if (!user?.password) {
    // An account created through an OAuth provider has no password to change.
    return NextResponse.json(
      { error: 'This account does not sign in with a password.' },
      { status: 409 }
    )
  }

  if (!(await bcrypt.compare(currentPassword, user.password))) {
    return NextResponse.json({ error: 'That is not your current password.' }, { status: 403 })
  }

  const verdict = checkPassword(newPassword, { email: user.email, name: user.name })
  if (!verdict.acceptable) {
    return NextResponse.json({ error: verdict.problems.join(' '), problems: verdict.problems }, { status: 422 })
  }

  if (await bcrypt.compare(newPassword, user.password)) {
    return NextResponse.json(
      { error: 'That is the password you are already using.' },
      { status: 422 }
    )
  }

  // Cost 12, matching registration. Changing it here and not there would mean
  // two populations of hashes with different costs and no record of which.
  await systemPrisma.user.update({
    where: { id: user.id },
    data: { password: await bcrypt.hash(newPassword, 12) },
  })

  // A successful change clears the attempt counter, so somebody who mistyped
  // their old password twice is not locked out of their own account afterwards.
  clearRateLimit(key)

  await systemPrisma.auditLog.create({
    data: {
      actorId: user.id,
      action: 'account.password.changed',
      entityType: 'User',
      entityId: user.id,
      // The address it came from, never the password or any part of it.
      diff: { from: clientIp(req.headers) },
    },
  })

  return NextResponse.json({
    ok: true,
    // Sessions are JWTs, so there is nothing to revoke. Anyone already signed in
    // as this account stays signed in until their token expires, which is eight
    // hours. Said plainly rather than left for somebody to assume otherwise.
    otherSessionsRemainValid: true,
  })
}
