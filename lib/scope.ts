import { prisma } from '@/lib/prisma'
import type { Session } from 'next-auth'
import type { UserRole } from '@/lib/auth'
import {
  innovatorWhere,
  type ScopedContext,
  type ScopeRole,
} from '@/lib/scope-rules'

/**
 * Application-wide authorisation context.
 *
 * The rules themselves live in `scope-rules.ts`, which has no dependencies so
 * they can be tested in isolation (`npm run test:scope`). This module resolves
 * the caller's identity from the session and the database.
 *
 * This started life as the AI assistant's security boundary, but the same rules
 * are what every API route needs: the codebase had no shared authorisation
 * helper at all (`requireAuth` and `canAccess` in `lib/auth.ts` were never
 * called), so each route inlined its own `getSession()` plus an `includes()`
 * check, and several forgot to scope by programme entirely.
 *
 * The critical invariant: `programmeId` is ALWAYS derived from the session here,
 * never accepted from a query string or request body. Several M&E routes used to
 * take it from `searchParams`, which let any authenticated facilitator or funder
 * read another programme's data by editing the URL.
 */
export {
  innovatorWhere,
  bookingWhere,
  assessmentWhere,
  programmeWhere,
} from '@/lib/scope-rules'
export type { ScopedContext, ScopeRole } from '@/lib/scope-rules'

/**
 * Resolve the caller's programme from their session.
 *
 * Lighter than `getScopedContext` for routes that only need the id.
 *
 * **Never take `programmeId` from a query string or request body.** Every M&E
 * route used to do exactly that, which let any authenticated facilitator or
 * funder read (and in the POST cases write) another programme's data by editing
 * the parameter. On a single-programme deployment that was invisible; with a
 * second funder on the platform it is a data breach.
 */
export async function resolveProgrammeId(session: Session): Promise<string | null> {
  if (session.user.programmeId) return session.user.programmeId

  // A super_admin with no explicit assignment falls back to the first
  // programme, matching the behaviour the rest of the app already relies on.
  const first = await prisma.programme.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  return first?.id ?? null
}

/**
 * Confirm the caller may act on a given programme.
 *
 * Used where a client legitimately supplies an id (for instance a super_admin
 * switching programmes): the id is checked against the session rather than
 * trusted. Returns the id to use, or null if the caller may not touch it.
 */
export async function assertProgrammeInScope(
  session: Session,
  requestedId: string | null | undefined
): Promise<string | null> {
  const own = await resolveProgrammeId(session)
  if (!requestedId) return own

  // Users pinned to a programme can only ever act on that one.
  if (session.user.programmeId) {
    return requestedId === session.user.programmeId ? requestedId : null
  }

  // super_admin with no pinned programme may address any programme that exists.
  if (session.user.role === 'super_admin') {
    const found = await prisma.programme.findUnique({
      where: { id: requestedId },
      select: { id: true },
    })
    return found?.id ?? null
  }

  return requestedId === own ? requestedId : null
}

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
