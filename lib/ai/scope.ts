import { prisma } from '@/lib/prisma'
import type { Session } from 'next-auth'
import type { UserRole } from '@/lib/auth'
import {
  innovatorWhere,
  type ScopedContext,
  type ScopeRole,
} from '@/lib/ai/scope-rules'

/**
 * Builds the assistant's authorisation context for the signed-in user.
 *
 * The rules themselves live in `scope-rules.ts`, which has no dependencies so
 * they can be tested in isolation (`npm run test:scope`). This module just
 * resolves the caller's identity from the session and the database.
 *
 * It exists because the codebase had no shared authorisation helper:
 * `requireAuth` and `canAccess` in `lib/auth.ts` were never called, and every
 * API route inlined its own `getSession()` + role-array check.
 */
export {
  innovatorWhere,
  bookingWhere,
  assessmentWhere,
  programmeWhere,
} from '@/lib/ai/scope-rules'
export type { ScopedContext, ScopeRole } from '@/lib/ai/scope-rules'

export async function getScopedContext(session: Session): Promise<ScopedContext> {
  const role = session.user.role as UserRole as ScopeRole
  const userId = session.user.id

  // Resolve the programme the way the rest of the app does: the user's own, or
  // the first programme for a super_admin with no explicit assignment.
  let programmeId = session.user.programmeId ?? null
  if (!programmeId) {
    const first = await prisma.programme.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    programmeId = first?.id ?? null
  }

  const programme = programmeId
    ? await prisma.programme.findUnique({
        where: { id: programmeId },
        select: {
          name: true,
          participantLabel: true,
          currencySymbol: true,
          moduleStipendsEnabled: true,
          moduleIPEnabled: true,
          moduleMandEEnabled: true,
        },
      })
    : null

  let innovatorId: string | null = null
  let mentorId: string | null = null

  if (role === 'innovator') {
    const profile = await prisma.innovatorProfile.findUnique({
      where: { userId },
      select: { id: true },
    })
    innovatorId = profile?.id ?? null
  }

  if (role === 'mentor') {
    const profile = await prisma.mentorProfile.findUnique({
      where: { userId },
      select: { id: true },
    })
    mentorId = profile?.id ?? null
  }

  return {
    userId,
    role,
    programmeId,
    innovatorId,
    mentorId,
    canSeePII: role !== 'funder_viewer',
    modules: {
      stipends: programme?.moduleStipendsEnabled ?? false,
      ip: programme?.moduleIPEnabled ?? false,
      mande: programme?.moduleMandEEnabled ?? false,
    },
    participantLabel: programme?.participantLabel ?? 'innovator',
    programmeName: programme?.name ?? null,
    currencySymbol: programme?.currencySymbol ?? 'R',
  }
}

/**
 * Guard for tools that accept an innovator id.
 *
 * Confirms the record exists *and* falls inside the caller's scope, so an id
 * guessed or hallucinated by the model cannot widen access.
 */
export async function assertInnovatorInScope(
  ctx: ScopedContext,
  innovatorId: string
): Promise<boolean> {
  const scope = innovatorWhere(ctx)
  if (!scope) return false
  const found = await prisma.innovatorProfile.findFirst({
    where: { AND: [{ id: innovatorId }, scope] },
    select: { id: true },
  })
  return found !== null
}
