import { quarterOf } from './quarterly'

/**
 * Whether a reporting period is fit to export.
 *
 * The reason this is a module of its own, and pure: the same checks have to run
 * twice, in two places that are easy to let drift. Once on the screen, so an
 * operator sees what is missing before they press the button, and once inside
 * the export, which is the only place that can be authoritative. A screen that
 * says a period is ready and an export that then refuses it is worse than
 * either alone.
 *
 * The distinction between the two lists is worth keeping sharp:
 *
 *   - A **blocker** would make the exported workbook untruthful. The export
 *     stops on it. Nobody should be able to press past one.
 *   - A **gap** is something the funder asks for that is not there yet. The
 *     export proceeds, because a report filed late is its own problem, but the
 *     operator is told before rather than after.
 */

export interface ReadinessActivity {
  code: string
  budget: number
  actual: number
  hasReason: boolean
}

export interface ReadinessInput {
  periodLabel: string
  amountTransferred: number | null
  fundingBudgeted: number | null
  balanceBroughtForward: number | null
  bankBalance: number | null
  invoiceNumber: string | null
  preparedByName: string | null
  approvedByName: string | null
  activities: ReadinessActivity[]
  transactionCount: number
  uncodedCount: number
  withoutProofCount: number
}

export interface Readiness {
  blockers: string[]
  gaps: string[]
  ready: boolean
}

/** Differences below a cent are floating point, not variance. */
function differs(budget: number, actual: number): boolean {
  return Math.round((budget - actual) * 100) !== 0
}

export function assessReadiness(input: ReadinessInput): Readiness {
  const blockers: string[] = []
  const gaps: string[] = []

  if (quarterOf(input.periodLabel) === null) {
    blockers.push(
      `The period is labelled "${input.periodLabel}", which does not name a quarter. ` +
        `The sheet reports one quarter of a four-quarter budget and works out which one from this label.`
    )
  }

  if (input.transactionCount === 0) {
    blockers.push('No transactions fall in this period, so there is nothing to report.')
  }

  const unexplained = input.activities.filter(
    (a) => differs(a.budget, a.actual) && !a.hasReason
  )
  if (unexplained.length > 0) {
    gaps.push(
      `${unexplained.length} ${unexplained.length === 1 ? 'activity differs' : 'activities differ'} ` +
        `from budget with no written reason: ${unexplained
          .slice(0, 5)
          .map((a) => a.code)
          .join(', ')}${unexplained.length > 5 ? ' and others' : ''}.`
    )
  }

  if (input.uncodedCount > 0) {
    gaps.push(
      `${input.uncodedCount} ${input.uncodedCount === 1 ? 'transaction is' : 'transactions are'} ` +
        `not coded to an activity, so ${input.uncodedCount === 1 ? 'it' : 'they'} appear on the ` +
        `expenditure sheet but in no activity's actual.`
    )
  }

  if (input.withoutProofCount > 0) {
    gaps.push(
      `${input.withoutProofCount} ${input.withoutProofCount === 1 ? 'transaction has' : 'transactions have'} ` +
        `no evidence attached.`
    )
  }

  if (input.amountTransferred === null) {
    gaps.push('The amount transferred by the funder has not been recorded.')
  }
  if (input.fundingBudgeted === null) {
    gaps.push('The funding budgeted for the quarter has not been recorded.')
  }
  if (input.balanceBroughtForward === null) {
    gaps.push('The balance brought forward from the previous quarter has not been recorded.')
  }
  if (input.bankBalance === null) {
    gaps.push('The closing bank and cash balance has not been recorded.')
  }
  if (!input.invoiceNumber) {
    gaps.push('The invoice number has not been recorded.')
  }
  if (!input.preparedByName || !input.approvedByName) {
    gaps.push(
      'The declaration has no preparer or approver, and the template carries the previous submitter’s name until one is given.'
    )
  }

  return { blockers, gaps, ready: blockers.length === 0 }
}
