import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toCents,
  fromCents,
  fundBalances,
  managementFee,
  canAllocate,
  canAward,
  tranchesReconcile,
  canPayTranche,
  grantBalances,
  type Tranche,
} from './rules'

const R = (rands: number) => toCents(rands)

/* ------------------------------------------------------------------ *
 * Money
 * ------------------------------------------------------------------ */

test('money converts without drift', () => {
  assert.equal(toCents(1000), 100000)
  assert.equal(toCents(0.1 + 0.2), 30)
  assert.equal(fromCents(30), 0.3)
})

test('a third of a cent rounds rather than accumulating', () => {
  assert.equal(toCents(10.005), 1001)
  assert.equal(toCents(10.004), 1000)
})

/* ------------------------------------------------------------------ *
 * Fund balances
 * ------------------------------------------------------------------ */

const position = {
  committed: R(5_000_000),
  received: R(2_000_000),
  allocated: R(2_000_000),
  awarded: R(1_800_000),
  disbursed: R(1_450_000),
}

test('the fund position answers the questions a fund manager is asked', () => {
  const b = fundBalances(position)
  assert.equal(fromCents(b.uncommitted), 3_000_000)
  assert.equal(fromCents(b.cashOnHand), 550_000)
  assert.equal(fromCents(b.payableCommitments), 350_000)
  assert.equal(fromCents(b.freeCash), 200_000)
})

test('free cash goes negative when more is promised than held', () => {
  const b = fundBalances({ ...position, awarded: R(2_000_000), disbursed: R(1_900_000) })
  assert.equal(fromCents(b.cashOnHand), 100_000)
  assert.equal(fromCents(b.payableCommitments), 100_000)
  assert.equal(b.freeCash, 0)

  const tight = fundBalances({ ...position, received: R(1_500_000) })
  assert.ok(tight.freeCash < 0, 'should warn when commitments exceed cash')
})

/* ------------------------------------------------------------------ *
 * Management fee
 * ------------------------------------------------------------------ */

test('a fee on commitment is earned whether or not money moves', () => {
  assert.equal(fromCents(managementFee(position, 0.075, 'Commitment')), 375_000)
})

test('a fee on disbursement follows the money out', () => {
  assert.equal(fromCents(managementFee(position, 0.075, 'Disbursement')), 108_750)
})

test('no rate means no fee', () => {
  assert.equal(managementFee(position, null, null), 0)
  assert.equal(managementFee(position, 0.075, null), 0)
})

test('a percentage typed as a rate is refused, not invoiced', () => {
  // 7.5 meaning "7.5 percent" would bill seven and a half times the fund.
  assert.throws(() => managementFee(position, 7.5, 'Commitment'), /is not a rate/)
  assert.throws(() => managementFee(position, -0.01, 'Commitment'), /is not a rate/)
})

/* ------------------------------------------------------------------ *
 * Allocation
 * ------------------------------------------------------------------ */

test('a fund cannot be allocated beyond its commitment', () => {
  const ok = canAllocate(R(1_000_000), R(600_000), R(400_000))
  assert.equal(ok.allowed, true)
  assert.equal(ok.remaining, 0)

  const over = canAllocate(R(1_000_000), R(600_000), R(500_000))
  assert.equal(over.allowed, false)
  assert.match(over.reason!, /committed at 1000000/)
})

test('a negative allocation is refused', () => {
  assert.equal(canAllocate(R(1_000_000), 0, R(-1)).allowed, false)
})

/* ------------------------------------------------------------------ *
 * Awarding
 * ------------------------------------------------------------------ */

test('a programme cannot award beyond its own allocation', () => {
  const ok = canAward(R(500_000), R(400_000), R(100_000))
  assert.equal(ok.allowed, true)

  const over = canAward(R(500_000), R(400_000), R(100_001))
  assert.equal(over.allowed, false)
  assert.match(over.reason!, /100000.00 left/)
})

test('a programme that has spent its share cannot reach into the fund', () => {
  // The fund may well have money left; this programme's allocation does not.
  const over = canAward(R(500_000), R(500_000), R(1))
  assert.equal(over.allowed, false)
})

test('a grant has to be for something', () => {
  assert.equal(canAward(R(500_000), 0, 0).allowed, false)
  assert.equal(canAward(R(500_000), 0, R(-100)).allowed, false)
})

/* ------------------------------------------------------------------ *
 * Tranche schedule
 * ------------------------------------------------------------------ */

test('tranches must add up to the award', () => {
  const r = tranchesReconcile(R(300_000), [
    { amount: R(100_000), status: 'Paid' },
    { amount: R(100_000), status: 'Approved' },
    { amount: R(100_000), status: 'Pending' },
  ])
  assert.equal(r.balanced, true)
  assert.equal(r.difference, 0)
})

test('a cancelled tranche is how an award is reduced, not an error', () => {
  const r = tranchesReconcile(R(200_000), [
    { amount: R(100_000), status: 'Paid' },
    { amount: R(100_000), status: 'Approved' },
    { amount: R(100_000), status: 'Cancelled' },
  ])
  assert.equal(r.balanced, true)
})

test('a schedule that does not add up reports the gap', () => {
  const r = tranchesReconcile(R(300_000), [{ amount: R(250_000), status: 'Pending' }])
  assert.equal(r.balanced, false)
  assert.equal(fromCents(r.difference), -50_000)
})

/* ------------------------------------------------------------------ *
 * Paying a tranche - the rule this module exists for
 * ------------------------------------------------------------------ */

const healthyFund = fundBalances({
  committed: R(5_000_000),
  received: R(2_000_000),
  allocated: R(2_000_000),
  awarded: R(300_000),
  disbursed: R(100_000),
})

function schedule(...statuses: Tranche['status'][]): Tranche[] {
  return statuses.map((status, i) => ({ sequence: i + 1, amount: R(100_000), status }))
}

test('an approved first tranche on an active grant can be paid', () => {
  const all = schedule('Approved', 'Pending')
  const r = canPayTranche({ grantStatus: 'Active', tranche: all[0], allTranches: all, fund: healthyFund })
  assert.equal(r.allowed, true)
  assert.deepEqual(r.reasons, [])
})

test('the second tranche cannot be paid before the first', () => {
  const all = schedule('Approved', 'Approved')
  const r = canPayTranche({ grantStatus: 'Active', tranche: all[1], allTranches: all, fund: healthyFund })
  assert.equal(r.allowed, false)
  assert.match(r.reasons.join(' '), /Tranche 1 comes first/)
  assert.match(r.reasons.join(' '), /gates the next payment/)
})

test('once the first is paid the second is free', () => {
  const all = schedule('Paid', 'Approved')
  const r = canPayTranche({ grantStatus: 'Active', tranche: all[1], allTranches: all, fund: healthyFund })
  assert.equal(r.allowed, true)
})

test('a cancelled earlier tranche does not block the next', () => {
  const all = schedule('Cancelled', 'Approved')
  const r = canPayTranche({ grantStatus: 'Active', tranche: all[1], allTranches: all, fund: healthyFund })
  assert.equal(r.allowed, true)
})

test('a withheld earlier tranche does block the next', () => {
  const all = schedule('Withheld', 'Approved')
  const r = canPayTranche({ grantStatus: 'Active', tranche: all[1], allTranches: all, fund: healthyFund })
  assert.equal(r.allowed, false)
})

test('an unapproved tranche cannot be paid', () => {
  const all = schedule('Pending')
  const r = canPayTranche({ grantStatus: 'Active', tranche: all[0], allTranches: all, fund: healthyFund })
  assert.equal(r.allowed, false)
  assert.match(r.reasons.join(' '), /not been approved/)
})

test('a tranche on a draft grant cannot be paid', () => {
  const all = schedule('Approved')
  const r = canPayTranche({ grantStatus: 'Draft', tranche: all[0], allTranches: all, fund: healthyFund })
  assert.equal(r.allowed, false)
  assert.match(r.reasons.join(' '), /not been approved yet/)
})

test('a suspended or cancelled grant pays nothing', () => {
  const all = schedule('Approved')
  for (const status of ['Suspended', 'Cancelled'] as const) {
    const r = canPayTranche({ grantStatus: status, tranche: all[0], allTranches: all, fund: healthyFund })
    assert.equal(r.allowed, false, status)
  }
})

test('paying twice is refused', () => {
  const all = schedule('Paid')
  const r = canPayTranche({ grantStatus: 'Active', tranche: all[0], allTranches: all, fund: healthyFund })
  assert.equal(r.allowed, false)
  assert.match(r.reasons.join(' '), /already been paid/)
})

test('every problem is reported, not just the first', () => {
  const all = schedule('Pending', 'Pending')
  const r = canPayTranche({ grantStatus: 'Draft', tranche: all[1], allTranches: all, fund: healthyFund })
  assert.ok(r.reasons.length >= 3, `expected several reasons, got ${r.reasons.length}`)
})

test('too little cash warns but does not block', () => {
  const poor = fundBalances({
    committed: R(5_000_000), received: R(100_000), allocated: R(2_000_000),
    awarded: R(300_000), disbursed: R(60_000),
  })
  const all = schedule('Approved')
  const r = canPayTranche({ grantStatus: 'Active', tranche: all[0], allTranches: all, fund: poor })
  assert.equal(r.allowed, true, 'the operator may know about money the platform does not')
  assert.match(r.warnings.join(' '), /drawdown may be needed/)
})

test('unreviewed earlier spend is surfaced at the moment of paying more', () => {
  const all = schedule('Paid', 'Approved')
  const r = canPayTranche({
    grantStatus: 'Active', tranche: all[1], allTranches: all,
    fund: healthyFund, unreviewedExpenditure: R(40_000),
  })
  assert.equal(r.allowed, true)
  assert.match(r.warnings.join(' '), /has not been reviewed/)
})

/* ------------------------------------------------------------------ *
 * Grant position
 * ------------------------------------------------------------------ */

test('a grant reports what is owed and what is unaccounted for', () => {
  const b = grantBalances({
    awarded: R(300_000), paid: R(200_000), reported: R(180_000), accepted: R(150_000),
  })
  assert.equal(fromCents(b.outstanding), 100_000)
  assert.equal(fromCents(b.unaccounted), 50_000)
  assert.equal(b.accountedRatio, 0.75)
})

test('nothing paid means no ratio rather than a misleading zero', () => {
  const b = grantBalances({ awarded: R(300_000), paid: 0, reported: 0, accepted: 0 })
  assert.equal(b.accountedRatio, null)
})
