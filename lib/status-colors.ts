import type { BadgeVariant } from '@/components/ui/badge'

/**
 * One definition of "what colour is a status".
 *
 * Before this module there were seven, spread across the codebase and
 * disagreeing with each other:
 *   - `lib/ip-engine.ts` REC_CONFIG / STATUS_CONFIG (raw Tailwind in domain logic)
 *   - `components/shared/AuditLog.tsx` ACTION_COLOURS
 *   - `app/dashboard/mande/milestones/page.tsx` and `mande/page.tsx` (two halves
 *     of the same milestone map)
 *   - `app/dashboard/mande/logframe/page.tsx` and `mande/indicators/page.tsx`
 *   - inline ternaries in `app/dashboard/reports/page.tsx` and `dashboard/page.tsx`
 *     that re-implemented BookingStatus colouring the badge component already owned
 *
 * Everything now resolves to a `BadgeVariant`, so a status looks the same
 * wherever it appears and follows the theme.
 */

/** Semantic meaning, mapped once to the badge variants. */
const OK: BadgeVariant = 'success'
const PENDING: BadgeVariant = 'warning'
const ACTIVE: BadgeVariant = 'info'
const BAD: BadgeVariant = 'destructive'
const NEUTRAL: BadgeVariant = 'muted'
const QUIET: BadgeVariant = 'outline'

export interface StatusMeta {
  label: string
  variant: BadgeVariant
  /** Solid dot colour, for timeline and list markers. */
  dot: string
}

function meta(label: string, variant: BadgeVariant, dot: string): StatusMeta {
  return { label, variant, dot }
}

const DOT = {
  ok: 'bg-success',
  pending: 'bg-warning',
  active: 'bg-info',
  bad: 'bg-destructive',
  neutral: 'bg-muted-foreground/40',
} as const

export const BOOKING_STATUS: Record<string, StatusMeta> = {
  Confirmed: meta('Confirmed', ACTIVE, DOT.active),
  InProgress: meta('In Progress', PENDING, DOT.pending),
  Completed: meta('Completed', OK, DOT.ok),
  Cancelled: meta('Cancelled', BAD, DOT.bad),
  Rescheduled: meta('Rescheduled', NEUTRAL, DOT.neutral),
  NoShowPendingReview: meta('No-show — Review', QUIET, DOT.neutral),
}

export const STIPEND_STATUS: Record<string, StatusMeta> = {
  Eligible: meta('Eligible', OK, DOT.ok),
  NotEligible: meta('Not Eligible', BAD, DOT.bad),
  Pending: meta('Pending', PENDING, DOT.pending),
  Override: meta('Override', NEUTRAL, DOT.neutral),
}

export const MILESTONE_STATUS: Record<string, StatusMeta> = {
  NotStarted: meta('Not Started', NEUTRAL, DOT.neutral),
  InProgress: meta('In Progress', ACTIVE, DOT.active),
  Completed: meta('Completed', OK, DOT.ok),
  AtRisk: meta('At Risk', PENDING, DOT.pending),
  Delayed: meta('Delayed', BAD, DOT.bad),
}

export const IP_STATUS: Record<string, StatusMeta> = {
  NotAssessed: meta('Not Assessed', NEUTRAL, DOT.neutral),
  Assessed: meta('Assessed', ACTIVE, DOT.active),
  ApplicationPending: meta('Application Pending', PENDING, DOT.pending),
  Protected: meta('Protected', OK, DOT.ok),
  Expired: meta('Expired', BAD, DOT.bad),
}

/**
 * IP recommendation variants. The labels and advice text stay in
 * `lib/ip-engine.ts` — that is domain knowledge. Only presentation lives here.
 */
export const IP_RECOMMENDATION_VARIANT: Record<string, BadgeVariant> = {
  PatentRequired: ACTIVE,
  TrademarkRequired: ACTIVE,
  CopyrightApplicable: OK,
  TradeSecret: PENDING,
  MultipleProtection: ACTIVE,
  NoProtectionNeeded: NEUTRAL,
  ReviewRequired: PENDING,
}

/** Audit-log action verbs. Both tenses appear in the data. */
export const AUDIT_ACTION_VARIANT: Record<string, BadgeVariant> = {
  create: OK,
  created: OK,
  update: ACTIVE,
  updated: ACTIVE,
  delete: BAD,
  deleted: BAD,
  lock: NEUTRAL,
  locked: NEUTRAL,
}

/** Log-frame levels, ordered impact → input. */
export const LOGFRAME_LEVEL_VARIANT: Record<string, BadgeVariant> = {
  Impact: ACTIVE,
  Outcome: OK,
  Output: PENDING,
  Activity: NEUTRAL,
  Input: QUIET,
}

/** Indicator types. */
export const INDICATOR_TYPE_VARIANT: Record<string, BadgeVariant> = {
  Output: PENDING,
  Outcome: OK,
  Impact: ACTIVE,
  Process: NEUTRAL,
}

/** User roles, for the admin screens. */
export const ROLE_VARIANT: Record<string, BadgeVariant> = {
  super_admin: ACTIVE,
  facilitator: OK,
  mentor: PENDING,
  innovator: NEUTRAL,
  funder_viewer: QUIET,
}

/** Safe lookup — unknown keys fall back to a neutral badge. */
export function statusMeta(
  map: Record<string, StatusMeta>,
  key: string | null | undefined
): StatusMeta {
  if (key && map[key]) return map[key]
  return meta(key ?? 'Unknown', NEUTRAL, DOT.neutral)
}
