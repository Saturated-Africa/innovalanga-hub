import { QUARTERLY_CATEGORY_BANDS } from './workbook-schema'

/**
 * Laying activities onto the funder's quarterly sheet.
 *
 * Kept separate from the exporter, and free of any spreadsheet library, because
 * this is the part that decides whether a report can be produced truthfully.
 * The exporter writes cells; this works out which cells, and refuses when the
 * template has no room.
 *
 * The one piece of real arithmetic here is the actual-spend formula, and even
 * that is not arithmetic the platform performs. The template expresses an
 * activity's actual as a sum reaching into the expenditure sheet - in the file
 * the funder supplied, a sum of exactly one cell, because somebody linked each
 * activity to a single transaction by hand. That hand-linking is what this
 * module removes: the same formula shape now reaches every transaction coded to
 * the activity. Excel still computes the number, from cells the funder can
 * click through to, so the sheet remains auditable in the way they expect.
 */

/** Where one transaction's amount landed on the expenditure sheet. */
export interface BreakdownCell {
  column: number
  row: number
}

export interface QuarterlyActivity {
  id: string
  code: string
  details: string
  costCategory: string
  /** Budget for this quarter only, not the whole agreement. */
  budget: number
  /** Spend coded to this activity within the period, for the platform's own checks. */
  actual: number
  /** Cells on the expenditure sheet carrying this activity's spend. */
  cells: BreakdownCell[]
  reason: string | null
  comment: string | null
}

export interface QuarterlyPlacement {
  row: number
  activity: QuarterlyActivity
}

export interface QuarterlyPlan {
  placements: QuarterlyPlacement[]
  /** Rows in a band left over, which must be blanked so old data does not show. */
  rowsToClear: number[]
  /** Conditions that make an export untruthful. The export stops on these. */
  blockers: string[]
  warnings: string[]
}

/** A1-style column letter for a 1-based column index. */
export function columnLetter(index: number): string {
  let n = index
  let letters = ''
  while (n > 0) {
    const remainder = (n - 1) % 26
    letters = String.fromCharCode(65 + remainder) + letters
    n = Math.floor((n - 1) / 26)
  }
  return letters
}

/**
 * Collapse a sorted run of row numbers into A1 ranges.
 *
 * Not cosmetic. An activity with eighty transactions listed cell by cell
 * produces a formula long enough to approach Excel's limit and impossible for
 * anyone to read; `H5:H84` is both shorter and what a person would have
 * written.
 */
export function collapseRuns(rows: number[]): string[] {
  const sorted = [...new Set(rows)].sort((a, b) => a - b)
  const ranges: string[] = []
  let start = 0

  for (let i = 0; i < sorted.length; i++) {
    const isLast = i === sorted.length - 1
    const breaks = isLast || sorted[i + 1] !== sorted[i] + 1
    if (!breaks) continue
    ranges.push(
      sorted[start] === sorted[i] ? String(sorted[start]) : `${sorted[start]}:${sorted[i]}`
    )
    start = i + 1
  }

  return ranges
}

/**
 * The formula for an activity's actual spend, in the template's own idiom.
 *
 * Returns null when nothing is coded to the activity, so the caller writes a
 * plain zero. A `SUM()` over no cells is a broken formula, and a zero is what
 * the template itself holds on an activity with no spend.
 */
export function actualFormula(sheetName: string, cells: BreakdownCell[]): string | null {
  if (cells.length === 0) return null

  const byColumn = new Map<number, number[]>()
  for (const cell of cells) {
    const rows = byColumn.get(cell.column) ?? []
    rows.push(cell.row)
    byColumn.set(cell.column, rows)
  }

  const parts: string[] = []
  for (const column of [...byColumn.keys()].sort((a, b) => a - b)) {
    const letter = columnLetter(column)
    for (const run of collapseRuns(byColumn.get(column)!)) {
      const [from, to] = run.split(':')
      parts.push(
        to
          ? `'${sheetName}'!${letter}${from}:${letter}${to}`
          : `'${sheetName}'!${letter}${from}`
      )
    }
  }

  return `SUM(${parts.join(',')})`
}

/**
 * Which quarter's budget column a reporting period draws on.
 *
 * The sheet holds a year of budget split four ways and reports one quarter at a
 * time, so the period's label is what selects the column. Returns null for a
 * label that names no quarter, which the caller reports rather than guessing at
 * - picking the wrong quarter's budget would make every variance on the sheet
 * wrong in a way that looks entirely plausible.
 */
export function quarterOf(periodLabel: string): 1 | 2 | 3 | 4 | null {
  const match = periodLabel.match(/\bQ\s*([1-4])\b/i)
  if (!match) return null
  return Number(match[1]) as 1 | 2 | 3 | 4
}

export interface CategoryBand {
  category: string
  headingRow: number
  firstRow: number
  lastRow: number
  subtotalIsFormula: boolean
}

/**
 * Place every activity into its category's band.
 *
 * Activities keep their given order within a category, so a sheet exported
 * twice reads the same way both times.
 *
 * The bands are a parameter with a default rather than a constant reference, so
 * this logic can be exercised on a small fixture geometry. Tying the tests to
 * the live template meant that widening the template broke three of them while
 * saying nothing about whether the placement rules still held.
 */
export function planQuarterly(
  activities: QuarterlyActivity[],
  bands: CategoryBand[] = QUARTERLY_CATEGORY_BANDS
): QuarterlyPlan {
  const placements: QuarterlyPlacement[] = []
  const rowsToClear: number[] = []
  const blockers: string[] = []
  const warnings: string[] = []

  const placed = new Set<string>()

  for (const band of bands) {
    const mine = activities.filter((a) => a.costCategory === band.category)
    for (const a of mine) placed.add(a.id)

    const capacity = band.lastRow - band.firstRow + 1

    if (mine.length > 0 && !band.subtotalIsFormula) {
      // The band exists but nothing above it adds it up, so anything written
      // here is money the funder's own grand total will not see.
      blockers.push(
        `The template's ${band.category} subtotal is a typed zero rather than a sum of its rows, ` +
          `so the ${mine.length} ${band.category.toLowerCase()} ${mine.length === 1 ? 'activity' : 'activities'} ` +
          `on this project cannot be reported on the quarterly sheet. The funder needs to reissue the ` +
          `template with a working subtotal for that section.`
      )
      continue
    }

    if (mine.length > capacity) {
      blockers.push(
        `The ${band.category} section has room for ${capacity} ` +
          `${capacity === 1 ? 'activity' : 'activities'} and this project has ${mine.length}. ` +
          `Rows cannot be added without breaking the subtotal beneath them.`
      )
      continue
    }

    let row = band.firstRow
    for (const activity of mine) {
      placements.push({ row, activity })
      row += 1
    }
    for (; row <= band.lastRow; row++) rowsToClear.push(row)
  }

  const orphans = activities.filter((a) => !placed.has(a.id))
  for (const a of orphans) {
    warnings.push(
      `Activity ${a.code} has cost category "${a.costCategory}", which the quarterly sheet has no section for.`
    )
  }

  for (const { activity } of placements) {
    // Rounded to cents before comparing, so a line that is level to the cent is
    // not flagged over a floating point remainder nobody can see or explain.
    const differs = Math.round((activity.budget - activity.actual) * 100) !== 0
    if (differs && !activity.reason) {
      warnings.push(
        `Activity ${activity.code} has no written reason for its variance. The funder asks for one wherever budget and actual differ.`
      )
    }
  }

  return { placements, rowsToClear, blockers, warnings }
}
