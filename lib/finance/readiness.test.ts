import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assessReadiness, type ReadinessInput } from './readiness'

function input(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    periodLabel: 'Q1',
    amountTransferred: 900000,
    fundingBudgeted: 900000,
    balanceBroughtForward: 0,
    bankBalance: 120000,
    invoiceNumber: 'INV-1',
    preparedByName: 'A Person',
    approvedByName: 'Another Person',
    activities: [],
    transactionCount: 10,
    uncodedCount: 0,
    withoutProofCount: 0,
    ...over,
  }
}

test('a complete period is ready with nothing outstanding', () => {
  const r = assessReadiness(input())
  assert.deepEqual(r.blockers, [])
  assert.deepEqual(r.gaps, [])
  assert.equal(r.ready, true)
})

test('a label that names no quarter blocks the export', () => {
  const r = assessReadiness(input({ periodLabel: 'January to March' }))
  assert.equal(r.ready, false)
  assert.match(r.blockers[0], /does not name a quarter/)
})

test('a period with no transactions blocks the export', () => {
  const r = assessReadiness(input({ transactionCount: 0 }))
  assert.equal(r.ready, false)
  assert.match(r.blockers[0], /nothing to report/)
})

test('a missing figure is a gap, not a blocker', () => {
  const r = assessReadiness(input({ amountTransferred: null }))
  assert.equal(r.ready, true)
  assert.equal(r.gaps.length, 1)
  assert.match(r.gaps[0], /amount transferred/)
})

test('an unexplained variance is named by activity code', () => {
  const r = assessReadiness(
    input({
      activities: [
        { code: '1.1', budget: 5000, actual: 4000, hasReason: false },
        { code: '1.2', budget: 5000, actual: 5000, hasReason: false },
      ],
    })
  )
  assert.equal(r.gaps.length, 1)
  assert.match(r.gaps[0], /1\.1/)
  assert.doesNotMatch(r.gaps[0], /1\.2/)
})

test('a variance with a reason raises nothing', () => {
  const r = assessReadiness(
    input({ activities: [{ code: '1.1', budget: 5000, actual: 4000, hasReason: true }] })
  )
  assert.deepEqual(r.gaps, [])
})

test('a difference below a cent is floating point, not variance', () => {
  const r = assessReadiness(
    input({ activities: [{ code: '1.1', budget: 0.1 + 0.2, actual: 0.3, hasReason: false }] })
  )
  assert.deepEqual(r.gaps, [])
})

test('long lists of unexplained activities are truncated, not dumped', () => {
  const r = assessReadiness(
    input({
      activities: Array.from({ length: 9 }, (_, i) => ({
        code: `1.${i}`,
        budget: 100,
        actual: 0,
        hasReason: false,
      })),
    })
  )
  assert.match(r.gaps[0], /and others/)
})

test('uncoded transactions and missing proof are separate gaps', () => {
  const r = assessReadiness(input({ uncodedCount: 3, withoutProofCount: 2 }))
  assert.equal(r.gaps.length, 2)
})
