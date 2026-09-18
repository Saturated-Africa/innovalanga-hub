import type { Cents, GrantStatus } from './rules'
import { fromCents } from './rules'

/**
 * What a participant may report spending, and what a reviewer may do about it.
 *
 * This is the other half of the grant lifecycle. Paying a tranche moves money
 * out; this is how it is accounted for, and the gap between the two is the
 * `unaccounted` figure a funder asks about first.
 *
 * Kept separate from the payment rules and dependency-free for the same reason:
 * it is the arithmetic and the state machine, testable without a database, and
 * the API and the UI both ask it rather than each forming its own opinion.
 */

export type ExpenditureStatus = 'Submitted' | 'Accepted' | 'Queried' | 'Rejected'

export interface SubmissionCheck {
  allowed: boolean
  /** Why it is refused. Empty when allowed. */
  reasons: string[]
  /** Worth saying, but not a refusal. */
  warnings: string[]
}

/** A grant that is finished or cancelled is not a grant you spend against. */
const OPEN_FOR_SPENDING: GrantStatus[] = ['Active', 'Suspended']

export interface SubmissionInput {
  grantStatus: GrantStatus
  /** Total paid out to the participant so far. */
  paid: Cents
  /** What the participant has already reported and not had rejected. */
  alreadyReported: Cents
  amount: Cents
  /** ISO date (YYYY-MM-DD) the money was spent. */
  spentOn: string
  /** ISO date for today, passed in so this stays a pure function. */
  today: string
  grantStartDate?: string | null
  grantEndDate?: string | null
}

/**
 * Whether a participant may report this spend.
 *
 * The one hard financial rule is that you cannot account for money you have not
 * been given: with nothing paid, there is nothing to account for, and a report
 * against an unpaid grant is either a mistake or an attempt to justify a
 * payment before it is released.
 *
 * Reporting *more* than was paid is a warning rather than a refusal. A
 * participant who put their own money in alongside the grant is doing something
 * legitimate and common, and blocking it would teach them to under-report,
 * which is worse than a figure a reviewer has to ask about.
 */
export function canSubmitExpenditure(input: SubmissionInput): SubmissionCheck {
  const reasons: string[] = []
  const warnings: string[] = []

  if (!OPEN_FOR_SPENDING.includes(input.grantStatus)) {
    reasons.push(
      `This grant is ${input.grantStatus.toLowerCase()}, so spending cannot be reported against it.`
    )
  }

  if (input.amount <= 0) {
    reasons.push('The amount has to be more than zero.')
  }

  if (input.paid <= 0) {
    reasons.push(
      'Nothing has been paid out on this grant yet, so there is nothing to account for.'
    )
  }

  if (input.spentOn > input.today) {
    reasons.push('The date is in the future.')
  }

  if (input.grantStartDate && input.spentOn < input.grantStartDate) {
    warnings.push(
      `This is dated before the grant started on ${input.grantStartDate}, so it may belong to another grant.`
    )
  }

  if (input.grantEndDate && input.spentOn > input.grantEndDate) {
    warnings.push(
      `This is dated after the grant ended on ${input.grantEndDate}, which a funder will query.`
    )
  }

  const reportedAfter = input.alreadyReported + input.amount
  if (input.paid > 0 && reportedAfter > input.paid) {
    warnings.push(
      `This brings the total reported to ${fromCents(reportedAfter).toFixed(2)} against ` +
        `${fromCents(input.paid).toFixed(2)} paid out. That is fine if the participant added ` +
        `their own money, and worth checking if not.`
    )
  }

  return { allowed: reasons.length === 0, reasons, warnings }
}

/**
 * The review state machine.
 *
 * `Queried` exists so a reviewer can send something back without rejecting it,
 * which is the common case: a receipt is missing or the description is too thin
 * to report to a funder. A queried item returns to `Submitted` when the
 * participant answers.
 *
 * `Accepted` and `Rejected` are terminal for the participant. They are not
 * terminal for a reviewer who got it wrong, because the alternative to
 * correcting a mistake is a duplicate row, and duplicated expenditure
 * overstates what a grant accounted for.
 */
const TRANSITIONS: Record<ExpenditureStatus, ExpenditureStatus[]> = {
  Submitted: ['Accepted', 'Queried', 'Rejected'],
  Queried: ['Submitted', 'Accepted', 'Rejected'],
  Accepted: ['Queried', 'Rejected'],
  Rejected: ['Queried', 'Accepted'],
}

export function canReview(
  from: ExpenditureStatus,
  to: ExpenditureStatus
): { allowed: boolean; reason?: string } {
  if (from === to) {
    return { allowed: false, reason: `This is already ${from.toLowerCase()}.` }
  }
  if (!TRANSITIONS[from].includes(to)) {
    return {
      allowed: false,
      reason: `Something ${from.toLowerCase()} cannot become ${to.toLowerCase()}.`,
    }
  }
  return { allowed: true }
}

/**
 * Whether the participant who submitted an item may still change it.
 *
 * Once a reviewer has accepted something, editing it would change a figure the
 * reviewer signed off, so the participant loses the pen. A queried item is
 * exactly the one they are being asked to fix.
 */
export function participantMayEdit(status: ExpenditureStatus): boolean {
  return status === 'Submitted' || status === 'Queried'
}

/** A query or a rejection has to say why, or the participant cannot act on it. */
export function reviewNeedsNote(to: ExpenditureStatus): boolean {
  return to === 'Queried' || to === 'Rejected'
}
