/**
 * What a fund manager is and is not allowed to do with somebody else's money.
 *
 * Kept pure and free of the database so the arithmetic can be tested directly.
 * Every rule here exists because breaking it has a real consequence for a real
 * person: a participant who does not get paid, or a funder who is told a number
 * that is not true.
 *
 * The convention throughout: money is handled in cents as integers. A fund's
 * balances are sums of many rows, and floating point addition of currency drifts
 * in exactly the way that makes two screens disagree by a cent and destroys
 * confidence in both. Callers convert at the edge.
 */

export type Cents = number

/** Round a decimal amount to whole cents. The only place a float becomes money. */
export function toCents(amount: number): Cents {
  return Math.round((amount + Number.EPSILON) * 100)
}

export function fromCents(cents: Cents): number {
  return cents / 100
}

export function sum(values: Cents[]): Cents {
  return values.reduce((total, value) => total + value, 0)
}

/* ------------------------------------------------------------------ *
 * Fund position
 * ------------------------------------------------------------------ */

export interface FundPosition {
  /** What the funder has promised. */
  committed: Cents
  /** What has actually arrived. */
  received: Cents
  /** What has been earmarked to programmes. */
  allocated: Cents
  /** What has been awarded to participants, whether paid yet or not. */
  awarded: Cents
  /** What has actually gone out of the door. */
  disbursed: Cents
}

export interface FundBalances extends FundPosition {
  /** Committed but not yet allocated to any programme. */
  uncommitted: Cents
  /** Received but not yet paid out. What the fund manager is holding. */
  cashOnHand: Cents
  /** Awarded but not yet paid. Money already promised to participants. */
  payableCommitments: Cents
  /**
   * Cash on hand less what is already promised.
   *
   * The number that answers "can we award anything more this quarter". It goes
   * negative when a fund has promised more than it holds, which is legitimate
   * while a drawdown is expected and alarming when one is not.
   */
  freeCash: Cents
}

export function fundBalances(position: FundPosition): FundBalances {
  const uncommitted = position.committed - position.allocated
  const cashOnHand = position.received - position.disbursed
  const payableCommitments = position.awarded - position.disbursed
  return {
    ...position,
    uncommitted,
    cashOnHand,
    payableCommitments,
    freeCash: cashOnHand - payableCommitments,
  }
}

/* ------------------------------------------------------------------ *
 * Management fee
 * ------------------------------------------------------------------ */

export type FeeBasis = 'Commitment' | 'Disbursement'

/**
 * The fee earned to date.
 *
 * On a commitment basis the fee is earned on the whole commitment whether or
 * not money moves; on a disbursement basis it is earned as money goes out. The
 * distinction is worth money and funders differ on it, so it is never assumed.
 *
 * `rate` is a rate: 0.075 is seven and a half percent. Rejecting anything above
 * 1 catches the person who typed 7.5 meaning percent, which would otherwise
 * invoice a funder for seven and a half times their own fund.
 */
export function managementFee(
  position: FundPosition,
  rate: number | null,
  basis: FeeBasis | null
): Cents {
  if (rate === null || basis === null) return 0
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error(
      `A management fee rate of ${rate} is not a rate. Use 0.075 for seven and a half percent.`
    )
  }
  const base = basis === 'Commitment' ? position.committed : position.disbursed
  return Math.round(base * rate)
}

/* ------------------------------------------------------------------ *
 * Allocation
 * ------------------------------------------------------------------ */

export interface AllocationCheck {
  allowed: boolean
  reason?: string
  /** What would be left uncommitted if this went ahead. */
  remaining: Cents
}

/**
 * Whether a fund can be allocated a further amount to a programme.
 *
 * `existingForProgramme` is passed separately because changing an allocation is
 * far more common than adding one, and treating an edit as an addition would
 * refuse a change that merely moves an existing figure.
 */
export function canAllocate(
  fundCommitted: Cents,
  allocatedElsewhere: Cents,
  proposed: Cents
): AllocationCheck {
  const remaining = fundCommitted - allocatedElsewhere - proposed
  if (proposed < 0) {
    return { allowed: false, reason: 'An allocation cannot be negative.', remaining }
  }
  if (remaining < 0) {
    return {
      allowed: false,
      reason:
        `That would allocate ${fromCents(allocatedElsewhere + proposed).toFixed(2)} ` +
        `from a fund committed at ${fromCents(fundCommitted).toFixed(2)}.`,
      remaining,
    }
  }
  return { allowed: true, remaining }
}

/* ------------------------------------------------------------------ *
 * Awarding
 * ------------------------------------------------------------------ */

export interface AwardCheck {
  allowed: boolean
  reason?: string
  remaining: Cents
}

/**
 * Whether a grant of this size can be awarded against a programme's allocation.
 *
 * Checked against what the programme has been allocated, not against the fund
 * as a whole. A programme that has spent its share cannot quietly reach into
 * another programme's money because the fund happens to have some left.
 */
export function canAward(
  allocatedToProgramme: Cents,
  alreadyAwarded: Cents,
  proposed: Cents
): AwardCheck {
  const remaining = allocatedToProgramme - alreadyAwarded - proposed
  if (proposed <= 0) {
    return { allowed: false, reason: 'A grant has to be for something.', remaining }
  }
  if (remaining < 0) {
    return {
      allowed: false,
      reason:
        `This programme has ${fromCents(allocatedToProgramme - alreadyAwarded).toFixed(2)} ` +
        `left of its allocation and the award is ${fromCents(proposed).toFixed(2)}.`,
      remaining,
    }
  }
  return { allowed: true, remaining }
}

/**
 * Whether a grant's tranches add up to what was awarded.
 *
 * Cancelled tranches are excluded: cancelling one is how an award is reduced in
 * practice, and counting it would make every reduced grant look wrong.
 */
export function tranchesReconcile(
  awarded: Cents,
  tranches: { amount: Cents; status: TrancheStatus }[]
): { balanced: boolean; scheduled: Cents; difference: Cents } {
  const scheduled = sum(
    tranches.filter((t) => t.status !== 'Cancelled').map((t) => t.amount)
  )
  return { balanced: scheduled === awarded, scheduled, difference: scheduled - awarded }
}

/* ------------------------------------------------------------------ *
 * Paying a tranche
 * ------------------------------------------------------------------ */

export type TrancheStatus = 'Pending' | 'Approved' | 'Paid' | 'Withheld' | 'Cancelled'
export type GrantStatus =
  | 'Draft'
  | 'Approved'
  | 'Active'
  | 'Suspended'
  | 'Completed'
  | 'Cancelled'

export interface Tranche {
  sequence: number
  amount: Cents
  status: TrancheStatus
}

export interface PaymentCheck {
  allowed: boolean
  /** Everything wrong, not just the first thing. */
  reasons: string[]
  /** Conditions worth showing the operator that do not block the payment. */
  warnings: string[]
}

/**
 * Whether a particular tranche may be paid now.
 *
 * This is the rule the whole module exists for. A funder releases money in
 * stages precisely so that the next stage depends on the last one being
 * accounted for, and the check has to live somewhere that every payment path
 * goes through rather than in whichever screen happened to be built first.
 *
 * Insufficient cash is a warning rather than a refusal. A fund manager paying
 * from a bank account the platform does not reconcile may legitimately know
 * better; being told is the point, being blocked is not.
 */
export function canPayTranche(input: {
  grantStatus: GrantStatus
  tranche: Tranche
  allTranches: Tranche[]
  fund: FundBalances
  /** Expenditure still unreviewed on money already paid to this participant. */
  unreviewedExpenditure?: Cents
}): PaymentCheck {
  const reasons: string[] = []
  const warnings: string[] = []
  const { grantStatus, tranche, allTranches, fund } = input

  if (grantStatus === 'Draft') reasons.push('The grant has not been approved yet.')
  if (grantStatus === 'Cancelled') reasons.push('The grant has been cancelled.')
  if (grantStatus === 'Suspended') reasons.push('The grant is suspended.')

  if (tranche.status === 'Paid') reasons.push('This tranche has already been paid.')
  if (tranche.status === 'Cancelled') reasons.push('This tranche has been cancelled.')
  if (tranche.status === 'Pending') {
    reasons.push('This tranche has not been approved for payment.')
  }
  if (tranche.status === 'Withheld') {
    reasons.push('This tranche is being withheld. Release it before paying.')
  }

  // The gate: everything before this one must be settled. A tranche that was
  // cancelled is settled; one still pending or withheld is not.
  const earlier = allTranches
    .filter((t) => t.sequence < tranche.sequence)
    .sort((a, b) => a.sequence - b.sequence)

  const unsettled = earlier.filter(
    (t) => t.status !== 'Paid' && t.status !== 'Cancelled'
  )
  if (unsettled.length > 0) {
    const list = unsettled.map((t) => t.sequence).join(', ')
    reasons.push(
      `Tranche ${list} ${unsettled.length === 1 ? 'comes' : 'come'} first and ` +
        `${unsettled.length === 1 ? 'has' : 'have'} not been paid. ` +
        `Approval of each tranche gates the next payment.`
    )
  }

  if (fund.cashOnHand < tranche.amount) {
    warnings.push(
      `The fund holds ${fromCents(fund.cashOnHand).toFixed(2)} and this payment is ` +
        `${fromCents(tranche.amount).toFixed(2)}. A drawdown may be needed first.`
    )
  }

  if (input.unreviewedExpenditure && input.unreviewedExpenditure > 0) {
    warnings.push(
      `${fromCents(input.unreviewedExpenditure).toFixed(2)} of this participant's ` +
        `earlier spend has not been reviewed.`
    )
  }

  return { allowed: reasons.length === 0, reasons, warnings }
}

/* ------------------------------------------------------------------ *
 * Grant position
 * ------------------------------------------------------------------ */

export interface GrantPosition {
  awarded: Cents
  paid: Cents
  /** Reported by the participant, whatever its review state. */
  reported: Cents
  /** Reported and accepted. */
  accepted: Cents
}

export interface GrantBalances extends GrantPosition {
  outstanding: Cents
  /** Paid but not yet accounted for by accepted evidence. */
  unaccounted: Cents
  /** Proportion of paid money accounted for, or null when nothing is paid. */
  accountedRatio: number | null
}

export function grantBalances(position: GrantPosition): GrantBalances {
  return {
    ...position,
    outstanding: position.awarded - position.paid,
    unaccounted: position.paid - position.accepted,
    accountedRatio: position.paid === 0 ? null : position.accepted / position.paid,
  }
}
