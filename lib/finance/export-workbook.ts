import * as ExcelJS from 'exceljs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  SHEETS,
  PROJECT_PLAN,
  BREAKDOWN,
  RECONCILIATION,
  QUARTERLY,
  BREAKDOWN_COLUMN_FOR,
  BREAKDOWN_CATEGORY_COLUMNS,
} from './workbook-schema'
import { allocationFormula, capacityCheck } from './formulas'
import {
  planQuarterly,
  actualFormula,
  quarterOf,
  type BreakdownCell,
  type QuarterlyActivity,
} from './quarterly'

/**
 * Produce the funder's quarterly financial report.
 *
 * The governing rule, and the reason this is a population step rather than a
 * generator: **the template's formulas are never touched.** Its file is opened,
 * values are written into the cells that hold data, and every formula is left
 * exactly as the funder wrote it. Excel recalculates on open. Nothing in this
 * module computes a variance, a subtotal or a surplus.
 *
 * Two consequences fall out of that and shape everything below.
 *
 * Rows are never inserted. Inserting a row inside a range does not extend the
 * formulas that depend on it, so the export writes into the blank rows the
 * template already provides. When a quarter has more transactions than there is
 * room for, the export stops and says so rather than truncating somebody's
 * financial report.
 *
 * Existing data is cleared before writing. The template supplied was a
 * completed report rather than a blank one, so its own rows have to go before
 * ours arrive - otherwise last year's transactions appear beneath this
 * quarter's and every total on every sheet is wrong.
 */

const TEMPLATE = path.join(
  process.cwd(),
  'lib/finance/templates/tia-quarterly-financial-report.xlsx'
)

export interface ExportActivity {
  id: string
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
  budgetQ1: number
  budgetQ2: number
  budgetQ3: number
  budgetQ4: number
  costCategory: string
  /** The funder asks for a written reason wherever budget and actual differ. */
  reason: string | null
  comment: string | null
}

export interface ExportIncomeLine {
  label: string
  budget: number
  actual: number
}

export interface ExportTransaction {
  spentOn: Date
  supplier: string
  description: string
  amount: number
  costCategory: string
  activityId: string | null
  activityCode: string | null
  /** Absolute, durable links to the evidence. Empty when none is attached. */
  invoiceUrl: string | null
  paymentUrl: string | null
}

export interface ExportInput {
  institutionName: string
  agreementNumber: string | null
  invoiceNumber: string | null
  periodLabel: string
  reportingPeriod: string
  amountTransferred: number | null
  bankBalance: number | null
  balanceBroughtForward: number | null
  fundingBudgeted: number | null
  incomeLines: ExportIncomeLine[]
  /** The declaration at the foot of the quarterly sheet. */
  preparedByName: string | null
  preparedOn: Date | null
  approvedByName: string | null
  approvedOn: Date | null
  activities: ExportActivity[]
  transactions: ExportTransaction[]
}

export interface ExportOutcome {
  /** The finished workbook, ready to stream to the browser. */
  buffer: ArrayBuffer
  warnings: string[]
}

/**
 * Conditions that would make the exported report untruthful.
 *
 * Distinct from a warning: a warning is something the operator should look at,
 * a blocker is something that would put a wrong number in front of a funder.
 * The export stops on these rather than producing a plausible-looking file.
 */
export class ExportBlockedError extends Error {
  constructor(readonly blockers: string[]) {
    super(blockers.join(' '))
    this.name = 'ExportBlockedError'
  }
}

export class ExportCapacityError extends Error {
  constructor(
    message: string,
    readonly needed: number,
    readonly capacity: number
  ) {
    super(message)
    this.name = 'ExportCapacityError'
  }
}

/**
 * Blank a range of cells without disturbing anything else.
 *
 * Only the value is cleared. Formatting, borders and column widths belong to
 * the funder's design and are left alone, so a half-filled sheet still looks
 * like their document.
 */
function clearCells(
  ws: ExcelJS.Worksheet,
  firstRow: number,
  lastRow: number,
  columns: number[],
  /**
   * Columns where a formula is the template's previous *data* rather than its
   * machinery, and must therefore go.
   *
   * The distinction matters more than it looks. On the expenditure sheet the
   * category of a transaction is expressed as a formula in whichever category
   * column applies, so the template's own rows carry one each. Leaving those in
   * place while writing ours put an amount under two categories on 35 rows of a
   * real export, silently inflating the funder's totals. A row total elsewhere
   * on the sheet is machinery and stays.
   */
  clearFormulasIn: number[] = []
) {
  const clearFormula = new Set(clearFormulasIn)
  for (let row = firstRow; row <= lastRow; row++) {
    for (const col of columns) {
      const cell = ws.getCell(row, col)
      const isFormula =
        typeof cell.value === 'object' && cell.value !== null && 'formula' in cell.value
      if (isFormula && !clearFormula.has(col)) continue
      cell.value = null
    }
  }
}

/**
 * Release any merged range that overlaps the rows about to be written.
 *
 * The template merges its subtotal rows across several columns. Writing a value
 * into a merged cell that is not the top-left of its range silently discards
 * it: three activities went missing from a real export exactly that way. The
 * merges being released here are the ones covering rows this export replaces.
 */
function unmergeDataRows(ws: ExcelJS.Worksheet, firstRow: number, lastRow: number) {
  const model = ws as unknown as { model?: { merges?: string[] } }
  const merges = [...(model.model?.merges ?? [])]
  for (const range of merges) {
    const match = range.match(/^[A-Z]+(\d+):[A-Z]+(\d+)$/)
    if (!match) continue
    const from = Number(match[1])
    const to = Number(match[2])
    if (to >= firstRow && from <= lastRow) {
      try {
        ws.unMergeCells(range)
      } catch {
        // Already released, or not a range this version will unmerge. Either
        // way the write below is what matters.
      }
    }
  }
}

/**
 * Write a labelled header value the way the funder's sheet presents it.
 *
 * These rows hold "Label: value" in a single merged cell. Writing to the second
 * column lands inside the merge and is dropped, and writing the bare value over
 * the whole cell loses the funder's own label. Both have happened.
 */
function writeLabelled(ws: ExcelJS.Worksheet, row: number, label: string, value: string | null) {
  if (value === null) return
  const cell = ws.getCell(row, 1)
  const existing = typeof cell.value === 'string' ? cell.value : ''
  const prefix = existing.includes(':') ? existing.split(':')[0] : label
  cell.value = `${prefix}: ${value}`
}

/** Column letters for the project plan's budget columns. */
const COLUMN_LETTERS: Record<number, string> = {
  12: 'L',
  13: 'M',
  14: 'N',
  15: 'O',
  16: 'P',
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * The date format the template's declaration already uses.
 *
 * Written out rather than delegated to a locale, because the server's locale
 * data is not the funder's and a report should not change shape with the
 * machine that produced it.
 */
function declarationDate(date: Date | null): string {
  if (!date) return ''
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

/** Whether a cell currently holds a formula, which is never overwritten. */
function isFormula(cell: ExcelJS.Cell): boolean {
  return typeof cell.value === 'object' && cell.value !== null && 'formula' in cell.value
}

/** Last row the template leaves usable before its own totals begin. */
function lastUsableRow(ws: ExcelJS.Worksheet, firstRow: number): number {
  // The breakdown's total row carries the word TOTAL in its first column.
  for (let row = firstRow; row <= ws.rowCount; row++) {
    const first = ws.getCell(row, 1).value
    if (typeof first === 'string' && first.trim().toUpperCase() === 'TOTAL') {
      return row - 1
    }
  }
  return ws.rowCount
}

export async function exportWorkbook(input: ExportInput): Promise<ExportOutcome> {
  const warnings: string[] = []
  const wb = new ExcelJS.Workbook()
  const template = await readFile(TEMPLATE)
  await wb.xlsx.load(
    template.buffer.slice(
      template.byteOffset,
      template.byteOffset + template.byteLength
    ) as ArrayBuffer
  )

  /* ---------------------------------------------------------------- *
   * Project plan
   * ---------------------------------------------------------------- */
  const plan = wb.getWorksheet(SHEETS.projectPlan)
  if (plan) {
    const c = PROJECT_PLAN.col
    const dataColumns = Object.values(c)
    const planLast = plan.rowCount
    const BUDGET_COLUMNS = [c.budgetQ1, c.budgetQ2, c.budgetQ3, c.budgetQ4, c.total]

    unmergeDataRows(plan, PROJECT_PLAN.firstDataRow, planLast)
    // The budget columns are cleared formulas and all. The template's own
    // sub-total rows live in this range, and their sums point at the rows the
    // funder's project occupied. Left in place they land in the middle of a
    // different project's activity list, adding up whichever rows happen to
    // fall where their milestone used to end.
    clearCells(plan, PROJECT_PLAN.firstDataRow, planLast, dataColumns, BUDGET_COLUMNS)

    // The sheet groups activities under a milestone and closes each group with
    // a sub-total, then adds those sub-totals into a grand total. Reproduced
    // here from the platform's own grouping, in the funder's own idiom - a sum
    // over the group's rows, and a grand total that adds the sub-total cells
    // rather than re-summing everything beneath them.
    const groups: { milestone: string | null; activities: ExportActivity[] }[] = []
    for (const activity of input.activities) {
      const last = groups[groups.length - 1]
      if (last && last.milestone === activity.milestone) last.activities.push(activity)
      else groups.push({ milestone: activity.milestone, activities: [activity] })
    }

    const rowsNeeded = input.activities.length + groups.length + (groups.length > 0 ? 1 : 0)
    const planCapacity = capacityCheck(rowsNeeded, PROJECT_PLAN.firstDataRow, planLast)
    if (!planCapacity.fits) {
      throw new ExportCapacityError(
        `The project plan needs ${rowsNeeded} rows for ${input.activities.length} activities ` +
          `and their sub-totals, and the template has ${planCapacity.capacity}.`,
        rowsNeeded,
        planCapacity.capacity
      )
    }

    const subtotalRows: number[] = []
    let row = PROJECT_PLAN.firstDataRow

    for (const [index, group] of groups.entries()) {
      const firstRowOfGroup = row

      for (const a of group.activities) {
        plan.getCell(row, c.milestone).value = a.milestone
        plan.getCell(row, c.workPackage).value = a.workPackage
        plan.getCell(row, c.objective).value = a.objective
        plan.getCell(row, c.activityNo).value = a.code
        plan.getCell(row, c.details).value = a.details
        plan.getCell(row, c.deliverable).value = a.deliverable
        plan.getCell(row, c.deliverableFormat).value = a.deliverableFormat
        plan.getCell(row, c.startMonth).value = a.startMonth ? `Month ${a.startMonth}` : null
        plan.getCell(row, c.endMonth).value = a.endMonth ? `Month ${a.endMonth}` : null
        plan.getCell(row, c.duration).value = a.duration
        plan.getCell(row, c.budgetQ1).value = a.budgetQ1
        plan.getCell(row, c.budgetQ2).value = a.budgetQ2
        plan.getCell(row, c.budgetQ3).value = a.budgetQ3
        plan.getCell(row, c.budgetQ4).value = a.budgetQ4
        // The column is headed TOTAL and the funder's sub-totals sum it, but
        // their own activity rows were left empty so every one of those sums
        // came to nothing. Filled here, with the four quarters beside it.
        plan.getCell(row, c.total).value = {
          formula: `SUM(L${row}:O${row})`,
        } as ExcelJS.CellFormulaValue
        row += 1
      }

      const lastRowOfGroup = row - 1
      plan.getCell(row, c.milestone).value = `Sub-Total ${index + 1}`
      for (const column of BUDGET_COLUMNS) {
        const letter = COLUMN_LETTERS[column]
        plan.getCell(row, column).value = {
          formula: `SUM(${letter}${firstRowOfGroup}:${letter}${lastRowOfGroup})`,
        } as ExcelJS.CellFormulaValue
      }
      subtotalRows.push(row)
      row += 1
    }

    if (subtotalRows.length > 0) {
      plan.getCell(row, c.milestone).value = `Grand Total (${subtotalRows
        .map((_, i) => `Sub-Total ${i + 1}`)
        .join(' + ')})`
      for (const column of BUDGET_COLUMNS) {
        const letter = COLUMN_LETTERS[column]
        plan.getCell(row, column).value = {
          formula: subtotalRows.map((r) => `${letter}${r}`).join('+'),
        } as ExcelJS.CellFormulaValue
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * Breakdown of expenditure
   * ---------------------------------------------------------------- */
  const breakdown = wb.getWorksheet(SHEETS.breakdown)
  if (!breakdown) {
    throw new Error('The template is missing its expenditure sheet.')
  }

  const b = BREAKDOWN.col
  const lastRow = lastUsableRow(breakdown, BREAKDOWN.firstDataRow)
  const capacity = capacityCheck(
    input.transactions.length,
    BREAKDOWN.firstDataRow,
    lastRow
  )

  if (!capacity.fits) {
    throw new ExportCapacityError(
      `This period has ${input.transactions.length} transactions but the template has room for ${capacity.capacity}. ` +
        `${capacity.overflow} would not fit. Rows cannot be inserted without breaking the funder's own totals, ` +
        `so the template needs more blank rows before this period can be exported.`,
      input.transactions.length,
      capacity.capacity
    )
  }

  unmergeDataRows(breakdown, BREAKDOWN.firstDataRow, lastRow)
  clearCells(
    breakdown,
    BREAKDOWN.firstDataRow,
    lastRow,
    Object.values(b),
    // Every column that could hold an allocation, not only the ones this
    // platform writes to. The template uses a second capital equipment column
    // that nothing maps to, and its leftovers double-counted 35 transactions.
    BREAKDOWN_CATEGORY_COLUMNS
  )

  // Where each activity's money landed on this sheet. The quarterly sheet
  // reports an activity's actual as a sum reaching into these cells, exactly as
  // the template does, so the two sheets agree by construction rather than by
  // both being computed the same way twice.
  const cellsByActivity = new Map<string, BreakdownCell[]>()

  let row = BREAKDOWN.firstDataRow
  for (const [index, t] of input.transactions.entries()) {
    breakdown.getCell(row, b.nr).value = index + 1
    breakdown.getCell(row, b.date).value = t.spentOn
    breakdown.getCell(row, b.date).numFmt = 'dd-mmm-yyyy'
    breakdown.getCell(row, b.supplier).value = t.supplier
    breakdown.getCell(row, b.description).value = t.description
    breakdown.getCell(row, b.amount).value = t.amount

    // Evidence. A hyperlink so the funder can click it straight from the sheet,
    // and the durable platform link rather than a presigned one, which would be
    // dead long before anybody opened this file.
    if (t.invoiceUrl) {
      breakdown.getCell(row, b.invoiceLink).value = {
        text: 'Invoice',
        hyperlink: t.invoiceUrl,
      }
    }
    if (t.paymentUrl) {
      breakdown.getCell(row, b.popLink).value = {
        text: 'Proof of payment',
        hyperlink: t.paymentUrl,
      }
    } else {
      breakdown.getCell(row, b.popLink).value = 'As Per Bank Statement'
    }

    // The category is expressed by which column carries the amount, exactly as
    // the template does it: a formula pointing back at the invoice cell rather
    // than a copy of the number.
    const column = BREAKDOWN_COLUMN_FOR[t.costCategory]
    if (column) {
      breakdown.getCell(row, column).value = {
        formula: allocationFormula('E', row).slice(1),
        result: t.amount,
      } as ExcelJS.CellFormulaValue
      if (t.activityId) {
        const cells = cellsByActivity.get(t.activityId) ?? []
        cells.push({ column, row })
        cellsByActivity.set(t.activityId, cells)
      }
    } else {
      warnings.push(
        `Transaction on row ${row} has category "${t.costCategory}", which the template has no column for.`
      )
    }

    if (!t.activityCode) {
      warnings.push(
        `${t.supplier} on ${t.spentOn.toISOString().slice(0, 10)} is not coded to an activity.`
      )
    }

    row += 1
  }

  /* ---------------------------------------------------------------- *
   * Quarterly financial - the sheet the funder actually reads
   * ---------------------------------------------------------------- */
  const quarterly = wb.getWorksheet(SHEETS.quarterly)
  if (quarterly) {
    const q = QUARTERLY.col

    // Which quarter's budget column to report. Guessing here would put a
    // plausible but wrong budget against every line on the sheet, so a label
    // that names no quarter stops the export instead.
    const quarter = quarterOf(input.periodLabel)
    if (quarter === null) {
      throw new ExportBlockedError([
        `The period is labelled "${input.periodLabel}", which does not name a quarter, ` +
          `so the sheet cannot tell which quarter's budget to report against. ` +
          `Rename the period Q1, Q2, Q3 or Q4.`,
      ])
    }

    const budgetFor = (a: ExportActivity) =>
      quarter === 1 ? a.budgetQ1 : quarter === 2 ? a.budgetQ2 : quarter === 3 ? a.budgetQ3 : a.budgetQ4

    const actualByActivity = new Map<string, number>()
    for (const t of input.transactions) {
      if (!t.activityId) continue
      actualByActivity.set(t.activityId, (actualByActivity.get(t.activityId) ?? 0) + t.amount)
    }

    // An activity belongs to one cost category and so sits in one section of
    // the sheet, but a transaction carries its own category and lands in its
    // own column on the expenditure sheet. Where the two disagree the money is
    // reported under the activity's section, which is the funder's structure
    // but rarely what the operator intended.
    const activityCategory = new Map(input.activities.map((a) => [a.id, a.costCategory]))
    for (const t of input.transactions) {
      if (!t.activityId) continue
      const owner = activityCategory.get(t.activityId)
      if (owner && owner !== t.costCategory) {
        warnings.push(
          `${t.supplier} on ${t.spentOn.toISOString().slice(0, 10)} is categorised ${t.costCategory} ` +
            `but coded to activity ${t.activityCode ?? '(unknown)'}, which the quarterly sheet reports ` +
            `under ${owner}. It will be counted under ${owner}.`
        )
      }
    }

    const plan = planQuarterly(
      input.activities.map<QuarterlyActivity>((a) => ({
        id: a.id,
        code: a.code,
        details: a.details,
        costCategory: a.costCategory,
        budget: budgetFor(a),
        actual: actualByActivity.get(a.id) ?? 0,
        cells: cellsByActivity.get(a.id) ?? [],
        reason: a.reason,
        comment: a.comment,
      }))
    )

    if (plan.blockers.length > 0) throw new ExportBlockedError(plan.blockers)
    warnings.push(...plan.warnings)

    /* Income. The funder splits money in three ways - what was carried over,
       what was budgeted for the quarter, and everything else - and gives the
       last of those four free rows. Only the budget and actual columns are
       data; the variance beside them is the template's own. */
    const income = QUARTERLY.income
    if (input.balanceBroughtForward !== null) {
      quarterly.getCell(income.balanceBroughtForwardRow, q.budget).value =
        input.balanceBroughtForward
    }
    if (input.fundingBudgeted !== null) {
      quarterly.getCell(income.fundingRow, q.budget).value = input.fundingBudgeted
    }

    const otherCapacity = income.otherLastRow - income.otherFirstRow + 1
    if (input.incomeLines.length > otherCapacity) {
      throw new ExportBlockedError([
        `The income section has room for ${otherCapacity} other-income lines and this period has ` +
          `${input.incomeLines.length}. Rows cannot be added without breaking the total beneath them.`,
      ])
    }

    let incomeRow = income.otherFirstRow
    for (const line of input.incomeLines) {
      quarterly.getCell(incomeRow, q.label).value = line.label
      quarterly.getCell(incomeRow, q.budget).value = line.budget
      quarterly.getCell(incomeRow, q.actual).value = line.actual
      incomeRow += 1
    }
    for (; incomeRow <= income.otherLastRow; incomeRow++) {
      // The template's placeholder labels go with them. Left behind they sit
      // beside this period's own lines and read as more of them.
      quarterly.getCell(incomeRow, q.label).value = null
      quarterly.getCell(incomeRow, q.budget).value = 0
      quarterly.getCell(incomeRow, q.actual).value = 0
    }

    /* Expenditure. Each activity's actual is a sum reaching into the
       expenditure sheet - the template's own idiom, now reaching every
       transaction coded to the activity rather than the single row somebody
       linked by hand. */
    for (const { row, activity } of plan.placements) {
      quarterly.getCell(row, q.label).value = `${activity.code} ${activity.details}`.trim()
      quarterly.getCell(row, q.budget).value = activity.budget

      const formula = actualFormula(SHEETS.breakdown, activity.cells)
      quarterly.getCell(row, q.actual).value = formula
        ? ({ formula, result: activity.actual } as ExcelJS.CellFormulaValue)
        : 0

      quarterly.getCell(row, q.reason).value = activity.reason
      quarterly.getCell(row, q.comment).value = activity.comment

      // Percentage variance. On rows the template has used this is already a
      // formula and is left alone; on rows it never filled it is a typed zero,
      // and filling one is what its author did every time they filled a row.
      // Left as the typed zero where there is no budget, rather than dividing
      // by it and shipping #DIV/0! to a funder.
      const percent = quarterly.getCell(row, q.percentVariance)
      if (!isFormula(percent) && activity.budget !== 0) {
        percent.value = {
          formula: `D${row}/B${row}`,
          result: null,
        } as unknown as ExcelJS.CellFormulaValue
      }
    }

    // Rows the template filled for a previous report that this project does not
    // reach. Left in place they read as this quarter's activities.
    for (const row of plan.rowsToClear) {
      for (const col of [q.label, q.reason, q.comment]) {
        const cell = quarterly.getCell(row, col)
        if (isFormula(cell)) continue
        cell.value = null
      }

      // Budget and actual are zeroed whether or not they hold a formula. A
      // formula in the actual column here is the template's link to a
      // particular transaction row from a previous report - its data, not its
      // machinery - and a quarter long enough to reach that row again would be
      // counted in two places at once. The same distinction, and the same bug,
      // as the category columns on the expenditure sheet.
      quarterly.getCell(row, q.budget).value = 0
      quarterly.getCell(row, q.actual).value = 0
    }

    /* Declaration. The template ships with the previous submitter's name and
       date typed in, so these are written even when empty - an unedited export
       would otherwise file somebody else's declaration under this agreement. */
    const d = QUARTERLY.declaration
    writeLabelled(quarterly, d.preparedByRow, 'Financial information prepared by', input.preparedByName ?? '')
    writeLabelled(quarterly, d.preparedDateRow, 'Date', declarationDate(input.preparedOn))
    writeLabelled(quarterly, d.approvedByRow, 'Financial Information Approved By', input.approvedByName ?? '')
    writeLabelled(quarterly, d.approvedDateRow, 'Date', declarationDate(input.approvedOn))

    if (!input.preparedByName || !input.approvedByName) {
      warnings.push(
        'The declaration on the quarterly sheet has no preparer or approver recorded, so it exports blank.'
      )
    }
  }

  /* ---------------------------------------------------------------- *
   * Bank and cash reconciliation
   * ---------------------------------------------------------------- */
  const rec = wb.getWorksheet(SHEETS.reconciliation)
  if (rec) {
    const R = RECONCILIATION
    writeLabelled(rec, R.institutionRow, 'Name of Institution', input.institutionName)
    writeLabelled(rec, R.periodRow, 'Current Reporting Period', input.reportingPeriod)
    writeLabelled(rec, R.agreementPeriodRow, 'Agreement Period', input.periodLabel)
    writeLabelled(rec, R.agreementNoRow, 'Agreement No', input.agreementNumber)
    writeLabelled(rec, R.invoiceNoRow, 'Invoice Number', input.invoiceNumber)

    if (input.amountTransferred !== null) {
      rec.getCell(R.transferredRow, R.valueCol).value = input.amountTransferred
    }

    // The expenses, surplus and bank balance cells all carry the template's own
    // formulas and are deliberately not written. One of them subtracts a
    // constant somebody typed into the formula by hand; that is the funder's
    // file to correct, not this exporter's.
    const expenses = rec.getCell(R.expensesRow, R.valueCol)
    if (
      typeof expenses.value === 'object' &&
      expenses.value !== null &&
      'formula' in expenses.value &&
      /-\s*\d/.test(String((expenses.value as ExcelJS.CellFormulaValue).formula))
    ) {
      warnings.push(
        'The reconciliation sheet subtracts a hard-coded number inside its own formula. ' +
          'Every report built from this template inherits it. Ask the funder for a blank template.'
      )
    }
  }

  /* ---------------------------------------------------------------- *
   * Headers on the quarterly and accumulated sheets
   * ---------------------------------------------------------------- */
  for (const name of [SHEETS.quarterly, SHEETS.accumulated, SHEETS.projection]) {
    const ws = wb.getWorksheet(name)
    if (!ws) continue
    for (let r = 1; r <= 6; r++) {
      const label = ws.getCell(r, 1).value
      if (typeof label !== 'string') continue
      if (/name of institution/i.test(label)) {
        writeLabelled(ws, r, 'Name of Institution', input.institutionName)
      }
      if (/current reporting period/i.test(label)) {
        writeLabelled(ws, r, 'Current Reporting Period', input.reportingPeriod)
      }
      if (/agreement no/i.test(label)) {
        writeLabelled(ws, r, 'Agreement No', input.agreementNumber)
      }
      if (/invoice number/i.test(label)) {
        writeLabelled(ws, r, 'Invoice Number', input.invoiceNumber)
      }
    }
  }

  // Excel stores the last computed value alongside each formula. Those cached
  // values belong to the template's old data, so they are discarded and the
  // workbook is marked for recalculation on open. Without this the funder sees
  // last year's totals until they press a key.
  wb.calcProperties.fullCalcOnLoad = true

  const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer
  return { buffer, warnings }
}
