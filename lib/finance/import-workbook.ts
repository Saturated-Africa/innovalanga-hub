import * as ExcelJS from 'exceljs'
import { SHEETS, PROJECT_PLAN, BREAKDOWN, RECONCILIATION, COST_CATEGORY_HEADINGS } from './workbook-schema'
import {
  normaliseActivityCode,
  parseAmount,
  amountOrZero,
  parseSheetDate,
  parseProofLink,
  parseMonthOffset,
  tidyText,
} from './normalise'

/**
 * Read a funder workbook into the shape the platform stores.
 *
 * Parsing only. Nothing here touches the database, so the whole import can be
 * run against a real file in a test and the result inspected. The caller
 * decides what to persist, which also makes a dry run possible: the operator
 * sees what would be created, and what the file's own problems are, before
 * anything is written.
 *
 * The guiding rule is that a messy cell is not a reason to reject a row. These
 * sheets are filled in by hand across a year. A row that cannot be understood
 * is reported as a problem against its row number and skipped; everything else
 * comes through.
 */

export type CostCategory = 'Personnel' | 'Operational' | 'CapitalEquipment' | 'Consumables'

export interface ImportedActivity {
  code: string
  milestone: string | null
  workPackage: string | null
  objective: string | null
  details: string
  deliverable: string | null
  deliverableFormat: string | null
  startMonth: number | null
  endMonth: number | null
  duration: string | null
  costCategory: CostCategory
  budgetQ1: number
  budgetQ2: number
  budgetQ3: number
  budgetQ4: number
  sortOrder: number
  sourceRow: number
}

export interface ImportedTransaction {
  spentOn: Date
  supplier: string
  description: string
  amount: number
  costCategory: CostCategory
  /** Links already in the sheet, kept so existing evidence is not lost. */
  invoiceLink: string | null
  popLink: string | null
  /** "As Per Bank Statement" and similar, which are notes rather than links. */
  proofNote: string | null
  sourceRow: number
}

export interface ImportedProject {
  institutionName: string | null
  agreementNumber: string | null
  agreementPeriod: string | null
  invoiceNumber: string | null
  reportingPeriod: string | null
  amountTransferred: number | null
  actualExpenses: number | null
  bankBalance: number | null
}

export interface ImportProblem {
  sheet: string
  row: number | null
  message: string
  severity: 'error' | 'warning'
}

export interface ImportResult {
  project: ImportedProject
  activities: ImportedActivity[]
  transactions: ImportedTransaction[]
  problems: ImportProblem[]
  totals: {
    transactionCount: number
    transactionTotal: number
    budgetTotal: number
    /** Rows the breakdown allocated to no category column at all. */
    uncategorised: number
  }
}

/**
 * Read one cell as a plain value.
 *
 * ExcelJS returns objects for formulas, hyperlinks and rich text, and those
 * nest: a hyperlink's `text` is itself frequently a rich text object rather
 * than a string. Unwrapping only one level produced supplier names that read
 * "[object Object]" - and that string would have travelled all the way onto a
 * funder's report. So the unwrapping recurses until it reaches something
 * printable, with a depth bound so a malformed file cannot spin here.
 */
function cell(ws: ExcelJS.Worksheet, row: number, col: number): unknown {
  return unwrap(ws.getCell(row, col).value, 0)
}

function unwrap(value: unknown, depth: number): unknown {
  if (depth > 5) return null
  if (value === null || value === undefined) return value
  if (value instanceof Date) return value
  if (typeof value !== 'object') return value

  const v = value as Record<string, unknown>

  if (Array.isArray(v)) {
    return v.map((part) => unwrap(part, depth + 1)).join('')
  }
  if ('richText' in v && Array.isArray(v.richText)) {
    return (v.richText as unknown[]).map((part) => unwrap(part, depth + 1)).join('')
  }
  if ('result' in v) return unwrap(v.result, depth + 1)
  if ('text' in v) return unwrap(v.text, depth + 1)
  if ('hyperlink' in v) return unwrap(v.hyperlink, depth + 1)
  if ('error' in v) return null

  // Anything else is not a value this importer understands. Returning null is
  // honest; returning the object would stringify as "[object Object]".
  return null
}

/**
 * Work out which cost category an activity sits under.
 *
 * The quarterly sheet lists activities beneath a category heading rather than
 * tagging each one, so the heading in force is carried down the rows.
 */
function categoriesByActivityCode(wb: ExcelJS.Workbook): Map<string, CostCategory> {
  const found = new Map<string, CostCategory>()
  const ws = wb.getWorksheet(SHEETS.quarterly)
  if (!ws) return found

  let current: CostCategory | null = null
  for (let row = 1; row <= ws.rowCount; row++) {
    const label = tidyText(cell(ws, row, 1))
    if (!label) continue

    const heading = COST_CATEGORY_HEADINGS.find((h) => h.match.test(label))
    if (heading) {
      current = heading.category as CostCategory
      continue
    }

    // Rows read like "1.1.1 Understand project objectives".
    const match = label.match(/^([\d.]+)\s+/)
    if (match && current) {
      const code = normaliseActivityCode(match[1])
      if (code && !found.has(code)) found.set(code, current)
    }
  }
  return found
}

function readProjectPlan(
  wb: ExcelJS.Workbook,
  categories: Map<string, CostCategory>,
  problems: ImportProblem[]
): ImportedActivity[] {
  const ws = wb.getWorksheet(SHEETS.projectPlan)
  if (!ws) {
    problems.push({
      sheet: SHEETS.projectPlan,
      row: null,
      message: 'Sheet not found. The workbook may not be the funder template.',
      severity: 'error',
    })
    return []
  }

  const c = PROJECT_PLAN.col
  const activities: ImportedActivity[] = []
  const seen = new Map<string, number>()

  // Milestone and work package are written once and left blank down the rows
  // beneath, so the last non-empty value carries forward.
  let milestone: string | null = null
  let workPackage: string | null = null
  let objective: string | null = null

  for (let row = PROJECT_PLAN.firstDataRow; row <= ws.rowCount; row++) {
    milestone = tidyText(cell(ws, row, c.milestone)) ?? milestone
    workPackage = tidyText(cell(ws, row, c.workPackage)) ?? workPackage
    objective = tidyText(cell(ws, row, c.objective)) ?? objective

    const code = normaliseActivityCode(cell(ws, row, c.activityNo))
    if (!code) continue

    // An activity number is dotted digits. Anything else in that column is a
    // subtotal or grand total row, which must not become an activity: its
    // budget is the sum of the rows above it and would be counted twice.
    if (!/^\d+(\.\d+)*$/.test(code)) continue

    // Sub-total rows repeat a milestone label with no activity of their own.
    const details = tidyText(cell(ws, row, c.details))
    if (!details) {
      problems.push({
        sheet: SHEETS.projectPlan,
        row,
        message: `Activity ${code} has no description and was skipped.`,
        severity: 'warning',
      })
      continue
    }

    const rawCode = tidyText(cell(ws, row, c.activityNo))
    if (rawCode && rawCode !== code) {
      problems.push({
        sheet: SHEETS.projectPlan,
        row,
        message: `Activity code "${rawCode}" was read as "${code}".`,
        severity: 'warning',
      })
    }

    const previous = seen.get(code)
    if (previous !== undefined) {
      problems.push({
        sheet: SHEETS.projectPlan,
        row,
        message: `Activity code "${code}" also appears on row ${previous}. Only the first was kept.`,
        severity: 'error',
      })
      continue
    }
    seen.set(code, row)

    activities.push({
      code,
      milestone,
      workPackage,
      objective,
      details,
      deliverable: tidyText(cell(ws, row, c.deliverable)),
      deliverableFormat: tidyText(cell(ws, row, c.deliverableFormat)),
      startMonth: parseMonthOffset(cell(ws, row, c.startMonth)),
      endMonth: parseMonthOffset(cell(ws, row, c.endMonth)),
      duration: tidyText(cell(ws, row, c.duration)),
      costCategory: categories.get(code) ?? 'Operational',
      budgetQ1: amountOrZero(cell(ws, row, c.budgetQ1)),
      budgetQ2: amountOrZero(cell(ws, row, c.budgetQ2)),
      budgetQ3: amountOrZero(cell(ws, row, c.budgetQ3)),
      budgetQ4: amountOrZero(cell(ws, row, c.budgetQ4)),
      sortOrder: activities.length,
      sourceRow: row,
    })
  }

  return activities
}

/** Which category column, if any, carries an amount on this row. */
function categoryFromColumns(
  ws: ExcelJS.Worksheet,
  row: number
): { category: CostCategory | null; allocated: number } {
  const c = BREAKDOWN.col
  const candidates: [CostCategory, number][] = [
    ['Personnel', c.personnel],
    ['Operational', c.overheads],
    ['Consumables', c.officeAndRent],
    ['CapitalEquipment', c.capital1],
    ['CapitalEquipment', c.capital2],
  ]

  for (const [category, col] of candidates) {
    const value = parseAmount(cell(ws, row, col))
    if (value !== null && value !== 0) return { category, allocated: value }
  }
  return { category: null, allocated: 0 }
}

function readBreakdown(
  wb: ExcelJS.Workbook,
  problems: ImportProblem[]
): { rows: ImportedTransaction[]; uncategorised: number } {
  const ws = wb.getWorksheet(SHEETS.breakdown)
  if (!ws) {
    problems.push({
      sheet: SHEETS.breakdown,
      row: null,
      message: 'Sheet not found.',
      severity: 'error',
    })
    return { rows: [], uncategorised: 0 }
  }

  const c = BREAKDOWN.col
  const rows: ImportedTransaction[] = []
  let uncategorised = 0

  for (let row = BREAKDOWN.firstDataRow; row <= ws.rowCount; row++) {
    const spentOn = parseSheetDate(cell(ws, row, c.date))
    const supplier = tidyText(cell(ws, row, c.supplier))
    const amount = parseAmount(cell(ws, row, c.amount))

    // A row with none of these is spacing or a total, not a transaction.
    if (!spentOn && !supplier && amount === null) continue

    if (!spentOn) {
      problems.push({
        sheet: SHEETS.breakdown, row,
        message: 'No usable date, row skipped.', severity: 'error',
      })
      continue
    }
    if (amount === null) {
      problems.push({
        sheet: SHEETS.breakdown, row,
        message: `No usable amount for "${supplier ?? 'unknown supplier'}", row skipped.`,
        severity: 'error',
      })
      continue
    }

    const { category, allocated } = categoryFromColumns(ws, row)
    if (!category) uncategorised += 1

    // The sample has rows where the invoice total and the amount allocated to a
    // category differ. That is worth surfacing rather than silently picking one.
    if (category && Math.abs(allocated - amount) > 0.01) {
      problems.push({
        sheet: SHEETS.breakdown, row,
        message: `Invoice amount ${amount.toFixed(2)} does not match the ${allocated.toFixed(2)} allocated to a category.`,
        severity: 'warning',
      })
    }

    const invoice = parseProofLink(cell(ws, row, c.invoiceLink))
    const pop = parseProofLink(cell(ws, row, c.popLink))

    rows.push({
      spentOn,
      supplier: supplier ?? 'Unknown',
      description: tidyText(cell(ws, row, c.description)) ?? '',
      amount,
      costCategory: category ?? 'Operational',
      invoiceLink: invoice.url,
      popLink: pop.url,
      proofNote: pop.note ?? invoice.note,
      sourceRow: row,
    })
  }

  return { rows, uncategorised }
}

function readReconciliation(wb: ExcelJS.Workbook): ImportedProject {
  const ws = wb.getWorksheet(SHEETS.reconciliation)
  const empty: ImportedProject = {
    institutionName: null, agreementNumber: null, agreementPeriod: null,
    invoiceNumber: null, reportingPeriod: null,
    amountTransferred: null, actualExpenses: null, bankBalance: null,
  }
  if (!ws) return empty

  const R = RECONCILIATION
  /**
   * These header rows read "Label: value", and where the split falls moves:
   * sometimes the whole string sits in one cell, sometimes the label is in the
   * first and the value in the second, and sometimes the second cell repeats
   * the label as well.
   *
   * The prefix is therefore stripped from whatever is found rather than assumed
   * absent. Without it the institution imports as "Name of Institution: ABC
   * Academy", and that whole string is what the funder then sees at the top of
   * their own report.
   */
  const stripLabel = (value: string | null): string | null => {
    if (!value) return null
    const colon = value.indexOf(':')
    return colon === -1 ? value : tidyText(value.slice(colon + 1))
  }

  const labelled = (row: number): string | null => {
    const second = stripLabel(tidyText(cell(ws, row, 2)))
    if (second) return second
    return stripLabel(tidyText(cell(ws, row, R.labelCol)))
  }

  return {
    institutionName: labelled(R.institutionRow),
    reportingPeriod: labelled(R.periodRow),
    agreementPeriod: labelled(R.agreementPeriodRow),
    agreementNumber: labelled(R.agreementNoRow),
    invoiceNumber: labelled(R.invoiceNoRow),
    amountTransferred: parseAmount(cell(ws, R.transferredRow, R.valueCol)),
    actualExpenses: parseAmount(cell(ws, R.expensesRow, R.valueCol)),
    bankBalance: parseAmount(cell(ws, R.bankBalanceRow, R.valueCol)),
  }
}

/** Parse a funder workbook. Never throws on bad data; reports it instead. */
export async function importWorkbook(buffer: ArrayBuffer | Buffer): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as ArrayBuffer)

  const problems: ImportProblem[] = []
  const categories = categoriesByActivityCode(wb)
  const activities = readProjectPlan(wb, categories, problems)
  const { rows: transactions, uncategorised } = readBreakdown(wb, problems)
  const project = readReconciliation(wb)

  const transactionTotal = transactions.reduce((sum, t) => sum + t.amount, 0)
  const budgetTotal = activities.reduce(
    (sum, a) => sum + a.budgetQ1 + a.budgetQ2 + a.budgetQ3 + a.budgetQ4,
    0
  )

  // The reconciliation sheet states the expenses total. If the transactions do
  // not add up to it, one of the two is wrong and an operator needs to know
  // before this becomes a funder report.
  if (project.actualExpenses !== null && Math.abs(project.actualExpenses - transactionTotal) > 1) {
    problems.push({
      sheet: SHEETS.reconciliation,
      row: RECONCILIATION.expensesRow,
      message: `Reconciliation states expenses of ${project.actualExpenses.toFixed(2)}, but the ${transactions.length} imported transactions total ${transactionTotal.toFixed(2)}.`,
      severity: 'warning',
    })
  }

  return {
    project,
    activities,
    transactions,
    problems,
    totals: {
      transactionCount: transactions.length,
      transactionTotal,
      budgetTotal,
      uncategorised,
    },
  }
}
