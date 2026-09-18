import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  canSubmitExpenditure,
  canReview,
  participantMayEdit,
  reviewNeedsNote,
  type SubmissionInput,
} from './expenditure'
import { toCents } from './rules'

/**
 * These tests exist because the expenditure rules decide two things that are
 * expensive to get wrong: whether a participant can account for money at all,
 * and whether a reviewer's decision can be walked back. Both are easier to
 * assert here than to discover on a funder's report.
 */

const base: SubmissionInput = {
  grantStatus: 'Active',
  paid: toCents(50_000),
  alreadyReported: 0,
  amount: toCents(1_000),
  spentOn: '2026-06-15',
  today: '2026-09-18',
  grantStartDate: '2026-04-01',
  grantEndDate: '2027-03-31',
}

describe('canSubmitExpenditure', () => {
  test('accepts an ordinary report against a paid, active grant', () => {
    const v = canSubmitExpenditure(base)
    assert.equal(v.allowed, true)
    assert.deepEqual(v.reasons, [])
    assert.deepEqual(v.warnings, [])
  })

  test('refuses when nothing has been paid, because there is nothing to account for', () => {
    const v = canSubmitExpenditure({ ...base, paid: 0 })
    assert.equal(v.allowed, false)
    assert.match(v.reasons.join(' '), /nothing has been paid out/i)
  })

  test('refuses a zero or negative amount', () => {
    assert.equal(canSubmitExpenditure({ ...base, amount: 0 }).allowed, false)
    assert.equal(canSubmitExpenditure({ ...base, amount: -100 }).allowed, false)
  })

  test('refuses a future date', () => {
    const v = canSubmitExpenditure({ ...base, spentOn: '2026-09-19' })
    assert.equal(v.allowed, false)
    assert.match(v.reasons.join(' '), /future/i)
  })

  test('allows spending dated today', () => {
    assert.equal(canSubmitExpenditure({ ...base, spentOn: base.today }).allowed, true)
  })

  test('refuses a cancelled or completed grant, allows a suspended one', () => {
    assert.equal(canSubmitExpenditure({ ...base, grantStatus: 'Cancelled' }).allowed, false)
    assert.equal(canSubmitExpenditure({ ...base, grantStatus: 'Completed' }).allowed, false)
    assert.equal(canSubmitExpenditure({ ...base, grantStatus: 'Draft' }).allowed, false)
    // Suspended is deliberately open: spending already incurred still has to be
    // accounted for, and a suspension is usually why it is being asked about.
    assert.equal(canSubmitExpenditure({ ...base, grantStatus: 'Suspended' }).allowed, true)
  })

  test('reports every reason at once rather than the first', () => {
    const v = canSubmitExpenditure({
      ...base,
      paid: 0,
      amount: 0,
      spentOn: '2027-01-01',
      grantStatus: 'Cancelled',
    })
    assert.equal(v.allowed, false)
    assert.equal(v.reasons.length, 4)
  })

  test('over-reporting warns but does not block', () => {
    const v = canSubmitExpenditure({
      ...base,
      paid: toCents(1_000),
      alreadyReported: toCents(800),
      amount: toCents(500),
    })
    assert.equal(v.allowed, true)
    assert.match(v.warnings.join(' '), /1300\.00 against 1000\.00/)
  })

  test('reporting exactly what was paid does not warn', () => {
    const v = canSubmitExpenditure({
      ...base,
      paid: toCents(1_000),
      alreadyReported: toCents(400),
      amount: toCents(600),
    })
    assert.equal(v.allowed, true)
    assert.deepEqual(v.warnings, [])
  })

  test('dates outside the grant period warn, on either side', () => {
    const before = canSubmitExpenditure({ ...base, spentOn: '2026-03-01' })
    assert.equal(before.allowed, true)
    assert.match(before.warnings.join(' '), /before the grant started/i)

    const after = canSubmitExpenditure({
      ...base,
      spentOn: '2027-06-01',
      today: '2027-07-01',
      grantEndDate: '2027-03-31',
    })
    assert.equal(after.allowed, true)
    assert.match(after.warnings.join(' '), /after the grant ended/i)
  })

  test('a grant with no dates set does not warn about dates', () => {
    const v = canSubmitExpenditure({
      ...base,
      grantStartDate: null,
      grantEndDate: null,
      spentOn: '2020-01-01',
    })
    assert.equal(v.allowed, true)
    assert.deepEqual(v.warnings, [])
  })
})

describe('canReview', () => {
  test('a submitted item can be accepted, queried or rejected', () => {
    for (const to of ['Accepted', 'Queried', 'Rejected'] as const) {
      assert.equal(canReview('Submitted', to).allowed, true, to)
    }
  })

  test('a queried item returns to submitted when the participant answers', () => {
    assert.equal(canReview('Queried', 'Submitted').allowed, true)
  })

  test('an accepted item cannot be re-accepted', () => {
    const v = canReview('Accepted', 'Accepted')
    assert.equal(v.allowed, false)
    assert.match(v.reason ?? '', /already accepted/i)
  })

  test('a reviewer can correct an accepted item, because the alternative is a duplicate', () => {
    assert.equal(canReview('Accepted', 'Rejected').allowed, true)
    assert.equal(canReview('Rejected', 'Accepted').allowed, true)
  })

  test('an accepted item cannot go straight back to submitted', () => {
    // Submitted is the participant's state. A reviewer wanting a change asks for
    // one by querying it, which is the state that tells the participant to act.
    assert.equal(canReview('Accepted', 'Submitted').allowed, false)
    assert.equal(canReview('Rejected', 'Submitted').allowed, false)
  })
})

describe('participantMayEdit', () => {
  test('the participant holds the pen until a reviewer accepts or rejects', () => {
    assert.equal(participantMayEdit('Submitted'), true)
    assert.equal(participantMayEdit('Queried'), true)
    assert.equal(participantMayEdit('Accepted'), false)
    assert.equal(participantMayEdit('Rejected'), false)
  })
})

describe('reviewNeedsNote', () => {
  test('a query or rejection has to say why', () => {
    assert.equal(reviewNeedsNote('Queried'), true)
    assert.equal(reviewNeedsNote('Rejected'), true)
    assert.equal(reviewNeedsNote('Accepted'), false)
  })
})
