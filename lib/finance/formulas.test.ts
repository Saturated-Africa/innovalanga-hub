import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  variance,
  percentVariance,
  toCents,
  sumAmounts,
  allocationFormula,
  capacityCheck,
} from './formulas.ts'

/**
 * The funder's formulas are never rewritten, so nothing here computes anything
 * that ends up in the exported workbook. These cover the platform's own screens
 * and the rules that constrain the exporter.
 */

test('a positive variance always means a good outcome', () => {
  // Income: more received than budgeted.
  assert.equal(variance('income', 100, 150), 50)
  // Expense: less spent than budgeted.
  assert.equal(variance('expense', 100, 80), 20)

  // And the bad cases are negative in both directions.
  assert.equal(variance('income', 100, 80), -20)
  assert.equal(variance('expense', 100, 130), -30)
})

test('the two income rows in the template disagree; one convention is chosen', () => {
  // The template computes the funding row as budget less actual and the row
  // beneath it as actual less budget, though both are income. Following its
  // own header note, income is actual less budget everywhere.
  assert.equal(variance('income', 924000, 283825.39), 283825.39 - 924000)
})

test('percentage variance uses the denominator the template documents', () => {
  assert.equal(percentVariance('expense', 20, 100, 80), 0.2, 'expense: over budget')
  assert.equal(percentVariance('income', 50, 100, 150), 50 / 150, 'income: over actual')
})

test('a zero denominator yields null rather than a misleading zero', () => {
  // A line with no budget and no spend has no meaningful percentage. Printing
  // 0% would invite the reader to treat it as on target.
  assert.equal(percentVariance('expense', 0, 0, 0), null)
  assert.equal(percentVariance('income', 10, 0, 0), null)
})

test('amounts round to cents so a report reconciles against a bank', () => {
  assert.equal(toCents(0.1 + 0.2), 0.3)
  assert.equal(toCents(283825.385), 283825.39)
})

test('summing many amounts does not accumulate floating point drift', () => {
  // The real breakdown holds 170 rows. Adding them naively produces the
  // ...38999999996 tail seen in the template's own total cell.
  const amounts = Array.from({ length: 170 }, () => 0.1)
  assert.equal(sumAmounts(amounts), 17)
})

test('an allocation reproduces the template’s own formula', () => {
  // A literal would work arithmetically but would change how the sheet behaves
  // when the funder edits the invoice amount.
  assert.equal(allocationFormula('E', 42), '=E42')
})

test('a quarter that outgrows the template is refused, not truncated', () => {
  // Rows are never inserted, because inserting one does not extend the ranges
  // the template's formulas depend on. Running out of room is a hard stop.
  const ok = capacityCheck(170, 4, 173)
  assert.equal(ok.fits, true)
  assert.equal(ok.capacity, 170)
  assert.equal(ok.overflow, 0)

  const tooMany = capacityCheck(200, 4, 173)
  assert.equal(tooMany.fits, false)
  assert.equal(tooMany.overflow, 30, 'the operator is told exactly how many do not fit')
})

test('the platform’s own variance convention is stated and consistent', () => {
  // The exported workbook keeps the template's inconsistency. This is only the
  // convention used on screen, and it is one rule everywhere.
  assert.equal(variance('income', 100, 150), 50)
  assert.equal(variance('expense', 100, 80), 20)
})
