/**
 * The assistant's authorisation rules.
 *
 * Deliberately dependency-free — no Prisma, no NextAuth, no path aliases — so
 * that the rules deciding what each role may read can be reasoned about and
 * tested in isolation. `scope.ts` supplies the context; this file decides what
 * that context is allowed to see.
 *
 * A predicate returning `null` means "this caller may see nothing". Callers
 * MUST treat that as "return no rows", never as "apply no filter" — that
 * distinction is the whole security boundary.
 */

export type ScopeRole =
  | 'super_admin'
  | 'facilitator'
  | 'mentor'
  | 'innovator'
  | 'funder_viewer'

export interface ScopedContext {
  userId: string
  role: ScopeRole
  /** Always resolved server-side. Never accepted as a tool argument. */
  programmeId: string | null
  /** Set when the caller is an innovator — restricts every read to this record. */
  innovatorId: string | null
  /** Set when the caller is a mentor. */
  mentorId: string | null
  /**
   * Whether personal data may appear in tool output at all.
   *
   * False for funder_viewer. Note this is stricter than the app's current CSV
   * exports, which do hand that role innovator names and individual stipend
   * amounts — a pre-existing gap flagged separately. The assistant honours the
   * documented rule regardless.
   */
  canSeePII: boolean
  /** Module flags, so the assistant does not offer disabled features. */
  modules: {
    stipends: boolean
    ip: boolean
    mande: boolean
  }
  /** The programme's own word for a participant ("innovator" by default). */
  participantLabel: string
  programmeName: string | null
  currencySymbol: string
}

/** Roles that may read records belonging to other people. */
const PROGRAMME_WIDE: ScopeRole[] = ['super_admin', 'facilitator']

/**
 * Restricts an InnovatorProfile query to what the caller may see.
 */
export function innovatorWhere(ctx: ScopedContext): Record<string, unknown> | null {
  if (ctx.role === 'innovator') {
    return ctx.innovatorId ? { id: ctx.innovatorId } : null
  }

  if (ctx.role === 'mentor') {
    // A mentor may see the innovators they have actually been booked with.
    return ctx.mentorId ? { bookings: { some: { mentorId: ctx.mentorId } } } : null
  }

  if (PROGRAMME_WIDE.includes(ctx.role)) {
    // InnovatorProfile has no programmeId of its own — scope through the cohort.
    return ctx.programmeId ? { cohort: { programmeId: ctx.programmeId } } : null
  }

  // funder_viewer and anything unrecognised: no per-person access.
  return null
}

/** Restricts a Booking query to what the caller may see. */
export function bookingWhere(ctx: ScopedContext): Record<string, unknown> | null {
  if (ctx.role === 'innovator') {
    return ctx.innovatorId ? { innovatorId: ctx.innovatorId } : null
  }
  if (ctx.role === 'mentor') {
    return ctx.mentorId ? { mentorId: ctx.mentorId } : null
  }
  if (PROGRAMME_WIDE.includes(ctx.role)) {
    return ctx.programmeId ? { innovator: { cohort: { programmeId: ctx.programmeId } } } : null
  }
  return null
}

/** Restricts an Assessment query to what the caller may see. */
export function assessmentWhere(ctx: ScopedContext): Record<string, unknown> | null {
  const inner = innovatorWhere(ctx)
  if (!inner) return null
  if (ctx.role === 'innovator') return { innovatorId: ctx.innovatorId }
  return { innovator: inner }
}

/** Programme-level M&E models are scoped by programmeId alone. */
export function programmeWhere(ctx: ScopedContext): Record<string, unknown> | null {
  return ctx.programmeId ? { programmeId: ctx.programmeId } : null
}
