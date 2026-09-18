/**
 * How the platform relates to the funder's workbook arithmetic.
 *
 * The governing rule: **the funder's formulas are never rewritten.** The
 * workbook is the deliverable, its sums are what TIA expects to see, and a
 * report that recalculates them a different way is a different document however
 * close the numbers land.
 *
 * So the exporter populates the template's input cells and leaves every formula
 * exactly as issued. Excel recalculates on open. The platform does not compute
 * variance, percentage variance, subtotals or the surplus for the deliverable.
 *
 * What remains here is the arithmetic the platform needs for its own screens -
 * so an operator can see where a quarter stands before exporting - plus the
 * cell-level helpers the exporter uses to write values into the right places.
 *
 * Two consequences worth stating, because they constrain the exporter:
 *
 *   1. Rows are never inserted. The template's ranges are fixed, and inserting
 *      a row inside one does not extend it, so the export writes into the blank
 *      rows the template already provides and reports an overflow rather than
 *      silently dropping a transaction.
 *
 *   2. Where the template contradicts itself - and it does, in the direction of
 *      income variance and in the denominator of percentage variance - that
 *      contradiction is preserved in the exported file. It is the funder's
 *      document. The platform's own screens use one consistent convention and
 *      say so, which is the only place the two can differ.
 */

export type LineKind = 'income' | 'expense'

/**
 * Variance, for the platform's own screens only.
 *
 * Written so a positive number always means a good outcome: more income than
 * planned, or less spent than planned. This follows the convention the
 * template's header notes describe.
 *
 * The template's formulas do not follow that note everywhere. On the quarterly
 * sheet the funding row computes budget less actual while the row beneath it
 * computes actual less budget, though both are income. The exported workbook
 * keeps both of those exactly as they are. This function is not used to produce
 * the export, so the two never conflict.
 */
export function variance(kind: LineKind, budget: number, actual: number): number {
  return kind === 'income' ? actual - budget : budget - actual
}

/**
 * Variance as a proportion, for the platform's own screens only.
 *
 * Returns null rather than zero when the denominator is zero: a line with no
 * budget and no spend has no meaningful percentage, and printing 0% invites the
 * reader to treat it as on target.
 */
export function percentVariance(
  kind: LineKind,
  varianceValue: number,
  budget: number,
  actual: number
): number | null {
  const denominator = kind === 'income' ? actual : budget
  if (!denominator) return null
  return varianceValue / denominator
}

/** Round to cents, so a figure on screen matches one from a bank. */
export function toCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** Sum amounts to cents, without floating point drift accumulating. */
export function sumAmounts(amounts: number[]): number {
  return toCents(amounts.reduce((total, amount) => total + amount, 0))
}

/**
 * Where a cost category's amount goes on the breakdown sheet.
 *
 * The template has no category field. The operator types the amount into
 * whichever category column applies, as a formula pointing back at the invoice
 * cell, so which column carries a formula IS the category. The exporter
 * reproduces that, writing the same `=E{row}` the template uses rather than a
 * literal, so the sheet behaves as the funder expects when they edit it.
 */
export function allocationFormula(amountColumn: string, row: number): string {
  return `=${amountColumn}${row}`
}

/**
 * Whether a set of rows fits the space the template provides.
 *
 * Because rows are never inserted, a quarter with more transactions than the
 * template has blank rows cannot be exported truthfully. That is a hard stop
 * with a clear message, not a silent truncation of somebody's financial report.
 */
export function capacityCheck(
  rowsNeeded: number,
  firstRow: number,
  lastAvailableRow: number
): { fits: boolean; capacity: number; overflow: number } {
  const capacity = lastAvailableRow - firstRow + 1
  return {
    fits: rowsNeeded <= capacity,
    capacity,
    overflow: Math.max(0, rowsNeeded - capacity),
  }
}
