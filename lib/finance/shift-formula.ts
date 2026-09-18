/**
 * Moving a spreadsheet's rows without breaking what points at them.
 *
 * The funder's template gives each cost category a fixed band of rows, and the
 * band for operational cost is one row long. A project with six operational
 * activities cannot be reported in it, and because every subtotal on the sheet
 * is a fixed range, writing outside the band produces money no total counts.
 *
 * So the template has to be reissued with room in it. Inserting rows is the
 * easy half; the half that goes wrong silently is that four sheets point at
 * those rows by number, including ninety-odd cells on the year-to-date sheet
 * that mirror the quarterly sheet line for line. A reference left unshifted
 * still computes - it just reports a different activity's money.
 *
 * This module does the shifting, and nothing else. It is deliberately separate
 * from the script that uses it so the arithmetic can be tested against cases
 * that are easy to get wrong: a reference above the insertion, one below it, a
 * range that straddles it, and a reference from another sheet.
 */

export interface Insertion {
  /** Rows are inserted immediately after this row. */
  after: number
  count: number
}

/** How far a row on a given sheet moves. */
export function shiftedRow(row: number, insertions: Insertion[]): number {
  let delta = 0
  for (const insertion of insertions) {
    if (row > insertion.after) delta += insertion.count
  }
  return row + delta
}

/**
 * A cell reference or range, with or without a sheet qualifier and dollar signs.
 *
 * A range is matched whole rather than as two references, because in
 * `'Quarterly financial'!C51:C52` the sheet qualifier governs both ends. Read
 * as two references, the second looks unqualified, is taken for the sheet the
 * formula sits on, and is then left where it was while its partner moves - a
 * range spanning a hundred and fifty rows of somebody else's report. That
 * happened, on the projection sheet's carry-over line.
 *
 * Anchored on a boundary that is not a letter, digit or underscore so that the
 * "E" in a function name or the tail of a defined name is never mistaken for a
 * column. Sheet names containing spaces are quoted in Excel, which is why both
 * forms are matched.
 */
const REFERENCE =
  /(?:'((?:[^']|'')+)'!|([A-Za-z_][A-Za-z0-9_.]*)!)?(\$?)([A-Z]{1,3})(\$?)(\d{1,7})(?::(\$?)([A-Z]{1,3})(\$?)(\d{1,7}))?/g

/**
 * Rewrite every row number in a formula to where that row has moved.
 *
 * An unqualified reference means the sheet the formula sits on; a qualified one
 * means the sheet it names. Getting that distinction wrong is the whole bug
 * this guards against, because the year-to-date sheet has insertions of its own
 * as well as references into a sheet with different ones.
 */
export function shiftFormula(
  formula: string,
  currentSheet: string,
  insertionsBySheet: Record<string, Insertion[]>
): string {
  return formula.replace(
    REFERENCE,
    (
      match: string,
      quotedSheet: string | undefined,
      bareSheet: string | undefined,
      colAbs: string,
      column: string,
      rowAbs: string,
      row: string,
      endColAbs: string | undefined,
      endColumn: string | undefined,
      endRowAbs: string | undefined,
      endRow: string | undefined,
      offset: number,
      whole: string
    ) => {
      // A reference is only a reference when what precedes it cannot be part of
      // a longer name. Without this, the "A1" inside a name like "TAX_A1" would
      // be rewritten.
      const before = offset > 0 ? whole[offset - 1] : ''
      if (before && /[A-Za-z0-9_.$]/.test(before) && !quotedSheet && !bareSheet) {
        return match
      }

      const sheet = quotedSheet ? quotedSheet.replace(/''/g, "'") : (bareSheet ?? currentSheet)
      const insertions = insertionsBySheet[sheet]
      if (!insertions || insertions.length === 0) return match

      // An absolute row ($10) still moves when rows are inserted above it.
      // Excel adjusts both; the dollar sign governs copying, not insertion.
      const prefix = quotedSheet
        ? `'${quotedSheet}'!`
        : bareSheet
          ? `${bareSheet}!`
          : ''
      const start = `${colAbs}${column}${rowAbs}${shiftedRow(Number(row), insertions)}`
      if (endColumn === undefined || endRow === undefined) return `${prefix}${start}`

      const end = `${endColAbs}${endColumn}${endRowAbs}${shiftedRow(Number(endRow), insertions)}`
      return `${prefix}${start}:${end}`
    }
  )
}
