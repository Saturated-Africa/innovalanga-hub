import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  collapseRuns,
  columnLetter,
  actualFormula,
  quarterOf,
  planQuarterly,
  type QuarterlyActivity,
} from './quarterly'

const SHEET = 'Breakdown expediture'

/**
 * A small geometry of the same shape as the real template, so these tests say
 * something about the placement rules rather than about the row numbers in a
 * file that is expected to be reissued.
 */
const BANDS = [
  { category: 'Personnel', headingRow: 18, firstRow: 19, lastRow: 41, subtotalIsFormula: true },
  { category: 'Operational', headingRow: 42, firstRow: 43, lastRow: 43, subtotalIsFormula: true },
  { category: 'CapitalEquipment', headingRow: 44, firstRow: 45, lastRow: 46, subtotalIsFormula: true },
  { category: 'Consumables', headingRow: 48, firstRow: 49, lastRow: 49, subtotalIsFormula: false },
]

function activity(over: Partial<QuarterlyActivity> = {}): QuarterlyActivity {
  return {
    id: over.id ?? 'a1',
    code: over.code ?? '1.1',
    details: over.details ?? 'Something',
    costCategory: over.costCategory ?? 'Personnel',
    budget: over.budget ?? 0,
    actual: over.actual ?? 0,
    cells: over.cells ?? [],
    reason: over.reason ?? null,
    comment: over.comment ?? null,
  }
}

test('column letters cross the 26 boundary', () => {
  assert.equal(columnLetter(1), 'A')
  assert.equal(columnLetter(8), 'H')
  assert.equal(columnLetter(26), 'Z')
  assert.equal(columnLetter(27), 'AA')
})

test('consecutive rows collapse into a range', () => {
  assert.deepEqual(collapseRuns([5, 6, 7]), ['5:7'])
  assert.deepEqual(collapseRuns([5, 7, 8, 12]), ['5', '7:8', '12'])
  assert.deepEqual(collapseRuns([]), [])
})

test('duplicate rows are counted once, or the sum double-counts', () => {
  assert.deepEqual(collapseRuns([5, 5, 6]), ['5:6'])
})

test('the actual formula keeps the template idiom', () => {
  assert.equal(
    actualFormula(SHEET, [{ column: 8, row: 5 }]),
    "SUM('Breakdown expediture'!H5)"
  )
})

test('cells in one column collapse, cells across columns do not', () => {
  const formula = actualFormula(SHEET, [
    { column: 8, row: 5 },
    { column: 8, row: 6 },
    { column: 11, row: 9 },
  ])
  assert.equal(
    formula,
    "SUM('Breakdown expediture'!H5:H6,'Breakdown expediture'!K9)"
  )
})

test('an activity with nothing coded to it gets no formula', () => {
  assert.equal(actualFormula(SHEET, []), null)
})

test('the quarter comes from the period label', () => {
  assert.equal(quarterOf('Q1'), 1)
  assert.equal(quarterOf('Q4 2026'), 4)
  assert.equal(quarterOf('Jan - March'), null)
  assert.equal(quarterOf('Q5'), null)
})

test('activities land in their own category band, in order', () => {
  const plan = planQuarterly([
    activity({ id: 'p1', code: '1.1' }),
    activity({ id: 'p2', code: '1.2' }),
    activity({ id: 'c1', code: '3.1', costCategory: 'CapitalEquipment' }),
  ], BANDS)
  assert.deepEqual(
    plan.placements.map((p) => [p.row, p.activity.code]),
    [
      [19, '1.1'],
      [20, '1.2'],
      [45, '3.1'],
    ]
  )
  assert.deepEqual(plan.blockers, [])
})

test('unused rows in a band are listed for clearing', () => {
  const plan = planQuarterly([activity({ id: 'p1' })], BANDS)
  assert.ok(plan.rowsToClear.includes(20))
  assert.ok(plan.rowsToClear.includes(41))
  assert.ok(!plan.rowsToClear.includes(19))
})

test('a category with more activities than rows blocks the export', () => {
  const plan = planQuarterly([
    activity({ id: 'o1', code: '2.1', costCategory: 'Operational' }),
    activity({ id: 'o2', code: '2.2', costCategory: 'Operational' }),
  ], BANDS)
  assert.equal(plan.placements.length, 0)
  assert.equal(plan.blockers.length, 1)
  assert.match(plan.blockers[0], /Operational section has room for 1/)
})

test('a category whose subtotal is a typed zero blocks the export', () => {
  const plan = planQuarterly([
    activity({ id: 'x1', code: '4.1', costCategory: 'Consumables' }),
  ], BANDS)
  assert.equal(plan.placements.length, 0)
  assert.match(plan.blockers[0], /typed zero/)
})

test('an empty consumables section is not a blocker', () => {
  const plan = planQuarterly([activity({ id: 'p1' })], BANDS)
  assert.deepEqual(plan.blockers, [])
})

test('a difference between budget and actual needs a written reason', () => {
  const plan = planQuarterly([
    activity({ id: 'p1', code: '1.1', budget: 5000, actual: 4200 }),
  ], BANDS)
  assert.equal(plan.warnings.length, 1)
  assert.match(plan.warnings[0], /1\.1 has no written reason/)
})

test('a line that matches its budget needs no reason', () => {
  const plan = planQuarterly([
    activity({ id: 'p1', code: '1.1', budget: 5000, actual: 5000 }),
  ], BANDS)
  assert.deepEqual(plan.warnings, [])
})

test('a supplied reason silences the warning', () => {
  const plan = planQuarterly([
    activity({ id: 'p1', budget: 5000, actual: 0, reason: 'Deferred to Q2.' }),
  ], BANDS)
  assert.deepEqual(plan.warnings, [])
})

test('a category the sheet has no section for is reported, not dropped silently', () => {
  const plan = planQuarterly([activity({ id: 'z1', code: '9.9', costCategory: 'Travel' })], BANDS)
  assert.equal(plan.placements.length, 0)
  assert.match(plan.warnings[0], /no section for/)
})
