import { prisma } from '@/lib/prisma'
import type { Session } from 'next-auth'

/**
 * Ownership checks for API routes.
 *
 * `scope.ts` answers "which rows may this caller read". This answers the
 * narrower question every mutating route needs: "does this caller own the
 * specific record they are trying to change".
 *
 * The routes here each had their own inline version of that check, and several
 * got it wrong in the same way: they confirmed the caller held a role, then
 * acted on a record belonging to someone else with that role. A mentor could
 * complete another mentor's booking; any signed-in user at all could rewrite a
 * mentor's availability. Centralising it means the check cannot be half-written
 * on the next route.
 */

/** Roles that may act on any record inside their programme. */
const PROGRAMME_ADMIN = ['super_admin', 'facilitator']

/**
 * Confirm the caller may act on this mentor's own records.
 *
 * The previous inline form was `if (role === 'mentor' && mentor.userId !== id)`,
 * which only ran the ownership test when the caller was a mentor. Every other
 * authenticated role skipped it entirely, and registration is public.
 */
export async function canActAsMentor(
  session: Session,
  mentorId: string
): Promise<boolean> {
  if (session.user.role === 'super_admin') return true
  if (session.user.role !== 'mentor') return false

  const owned = await prisma.mentorProfile.findFirst({
    where: { id: mentorId, userId: session.user.id },
    select: { id: true },
  })
  return owned !== null
}

/** The caller's own MentorProfile id, or null if they have none. */
export async function callerMentorId(session: Session): Promise<string | null> {
  if (session.user.role !== 'mentor') return null
  const profile = await prisma.mentorProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  })
  return profile?.id ?? null
}

/**
 * The participant record belonging to the caller, or null if they are not one.
 *
 * The counterpart to callerMentorId, and needed for the same reason: a
 * participant's own row is not identified by anything in the session, so a
 * route that means "this person's own grant" has to resolve it rather than
 * trust an id from the request.
 */
export async function callerInnovatorId(session: Session): Promise<string | null> {
  if (session.user.role !== 'innovator') return null
  const profile = await prisma.innovatorProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  })
  return profile?.id ?? null
}

/**
 * Confirm the caller may act on this booking.
 *
 * A mentor may act only on bookings assigned to them. Programme admins may act
 * on any booking within their own programme, resolved through the innovator's
 * cohort, so an admin on one programme cannot touch another funder's sessions.
 */
export async function canActOnBooking(
  session: Session,
  bookingId: string,
  programmeId: string | null
): Promise<boolean> {
  if (session.user.role === 'mentor') {
    const mentorId = await callerMentorId(session)
    if (!mentorId) return false
    const owned = await prisma.booking.findFirst({
      where: { id: bookingId, mentorId },
      select: { id: true },
    })
    return owned !== null
  }

  if (PROGRAMME_ADMIN.includes(session.user.role)) {
    if (!programmeId) return false
    const inProgramme = await prisma.booking.findFirst({
      where: { id: bookingId, innovator: { cohort: { programmeId } } },
      select: { id: true },
    })
    return inProgramme !== null
  }

  return false
}

/**
 * Confirm a document belongs to an innovator inside the caller's programme.
 *
 * Documents carry no programme of their own, so scope runs through the
 * innovator's cohort. Both the read and the delete route previously had a role
 * gate and no scope at all.
 */
export async function canAccessDocument(
  documentId: string,
  programmeId: string | null
): Promise<boolean> {
  if (!programmeId) return false
  const found = await prisma.document.findFirst({
    where: { id: documentId, innovator: { cohort: { programmeId } } },
    select: { id: true },
  })
  return found !== null
}

/** Confirm an innovator belongs to the caller's programme. */
export async function innovatorInProgramme(
  innovatorId: string,
  programmeId: string | null
): Promise<boolean> {
  if (!programmeId) return false
  const found = await prisma.innovatorProfile.findFirst({
    where: { id: innovatorId, cohort: { programmeId } },
    select: { id: true },
  })
  return found !== null
}

/**
 * Confirm a mentor belongs to the caller's programme.
 *
 * Mentors carry no programme of their own; the assignment lives on their user
 * account, which is also where a facilitator's does. A mentor whose account has
 * no programme is reachable only by a super_admin, who is cleared before any of
 * these checks run.
 */
export async function mentorInProgramme(
  mentorId: string,
  programmeId: string | null
): Promise<boolean> {
  if (!programmeId) return false
  const found = await prisma.mentorProfile.findFirst({
    where: { id: mentorId, user: { programmeId } },
    select: { id: true },
  })
  return found !== null
}

/**
 * Confirm the caller may change this mentor's schedule.
 *
 * Ownership and tenancy are both required, and they answer different questions.
 * Ownership stops one mentor editing another's calendar. Tenancy stops an
 * administrator on one funder's programme reaching into another's, which
 * ownership alone never checked because a super_admin passes it outright.
 */
export async function canManageMentorSchedule(
  session: Session,
  mentorId: string,
  programmeId: string | null
): Promise<boolean> {
  if (session.user.role === 'super_admin') return true
  if (!(await canActAsMentor(session, mentorId))) return false
  return mentorInProgramme(mentorId, programmeId)
}

/**
 * Confirm the caller may read this mentor's schedule.
 *
 * Wider than managing it, because a facilitator arranging sessions and an
 * innovator choosing a slot both need to know when a mentor is unavailable.
 * Narrower than it was: these routes previously required nothing but a session,
 * so any account on the platform could read every mentor's blackout periods -
 * and a blackout carries a written reason, which is usually a private one.
 */
export async function canReadMentorSchedule(
  session: Session,
  mentorId: string,
  programmeId: string | null
): Promise<boolean> {
  if (session.user.role === 'super_admin') return true
  if (await canActAsMentor(session, mentorId)) return true
  if (!PROGRAMME_ADMIN.includes(session.user.role) && session.user.role !== 'innovator') {
    return false
  }
  return mentorInProgramme(mentorId, programmeId)
}

/** Confirm an indicator belongs to the caller's programme. */
export async function indicatorInProgramme(
  indicatorId: string,
  programmeId: string | null
): Promise<boolean> {
  if (!programmeId) return false
  const found = await prisma.indicator.findFirst({
    where: { id: indicatorId, programmeId },
    select: { id: true },
  })
  return found !== null
}

/**
 * Confirm a stipend record belongs to an innovator in the caller's programme.
 *
 * Stipend records carry no programme, so scope runs through the innovator's
 * cohort - the same path the register itself uses.
 */
export async function stipendRecordInProgramme(
  stipendRecordId: string,
  programmeId: string | null
): Promise<boolean> {
  if (!programmeId) return false
  const found = await prisma.stipendRecord.findFirst({
    where: { id: stipendRecordId, innovator: { cohort: { programmeId } } },
    select: { id: true },
  })
  return found !== null
}
