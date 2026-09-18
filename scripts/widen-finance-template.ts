/**
 * Reissue the funder's quarterly template with room in it.
 *
 *   npx tsx scripts/widen-finance-template.ts
 *
 * Why this exists
 * ---------------
 * The template TIA supplied is a completed report, and its expenditure sections
 * are exactly as long as that project needed: twenty-three rows for personnel,
 * one for operational cost, two for capital equipment. Every subtotal is a
 * fixed range over its own section, so those lengths are not a layout choice -
 * they are a hard capacity. A row written outside a section is money the sheet
 * does not count, and the first real project put through this platform has six
 * operational activities.
 *
 * The consumables section is worse than short. Its subtotal is a typed zero
 * rather than a sum, so anything entered beneath it is invisible to every total
 * above it. That is a defect in the file, not a constraint to respect.
 *
 * What this does, and what it deliberately does not
 * -------------------------------------------------
 * It lengthens the four expenditure sections and gives consumables a working
 * subtotal. It does not change a single formula's meaning: every sum still sums
 * its own section, every variance is still budget less actual, and the grand
 * total still adds the same four subtotals. The layout, the column widths, the
 * funder's wording and the declaration all survive untouched.
 *
 * The part that is easy to get wrong is everything that points at the rows
 * being moved - the reconciliation sheet's expense line, the projection sheet's
 * carry-over, and ninety-odd cells on the year-to-date sheet that mirror the
 * quarterly sheet line by line. A reference left unshifted still computes; it
 * just reports a different activity's money. Every formula in the workbook is
 * therefore rewritten through the tested shifter in lib/finance/shift-formula.
 *
 * The year-to-date sheet's own totals read the quarterly sheet's subtotals
 * rather than summing its mirror rows, so widening leaves its arithmetic
 * correct. Its itemised list stays as long as the funder left it, which is
 * already shorter than the section it mirrors.
 *
 * The original file is kept beside the output, unmodified, as the record of
 * what was issued.
 */
import * as ExcelJS from 'exceljs'
import { readFile, writeFile, copyFile, access } from 'node:fs/promises'
import path from 'node:path'
import { shiftFormula, shiftedRow, type Insertion } from '../lib/finance/shift-formula'

const DIR = path.join(process.cwd(), 'lib/finance/templates')
const ORIGINAL = path.join(DIR, 'tia-quarterly-financial-report-as-issued.xlsx')
const OUTPUT = path.join(DIR, 'tia-quarterly-financial-report.xlsx')

const QUARTERLY = 'Quarterly financial'
const BREAKDOWN = 'Breakdown expediture'

/**
 * How many transaction rows the expenditure sheet should hold.
 *
 * The file as issued holds a hundred and seventy, which is exactly what that
 * project's quarter came to. The first quarter loaded into this platform also
 * came to a hundred and seventy, and an export that fits by one row is an
 * export that stops working next quarter.
 */
const BREAKDOWN_TARGET_ROWS = 600
const BREAKDOWN_FIRST_DATA_ROW = 4
/** Columns the sheet totals: invoice amount, then each category allocation. */
const BREAKDOWN_TOTAL_COLUMNS = [5, 8, 9, 10, 11, 12]

/** Sections of the expenditure block, in the original file's coordinates. */
const SECTIONS = [
  { name: 'Personnel', headingRow: 18, firstRow: 19, lastRow: 41, target: 60 },
  { name: 'Operational', headingRow: 42, firstRow: 43, lastRow: 43, target: 40 },
  { name: 'CapitalEquipment', headingRow: 44, firstRow: 45, lastRow: 46, target: 40 },
  { name: 'Consumables', headingRow: 48, firstRow: 49, lastRow: 49, target: 40 },
]

/** The TOTAL row closes the transaction list; everything above it is data. */
function findTotalRow(ws: ExcelJS.Worksheet): number {
  for (let row = 1; row <= ws.rowCount; row++) {
    const value = ws.getCell(row, 1).value
    if (typeof value === 'string' && value.trim().toUpperCase() === 'TOTAL') return row
  }
  throw new Error('The expenditure sheet has no TOTAL row.')
}

function columnLetter(index: number): string {
  let n = index
  let letters = ''
  while (n > 0) {
    const remainder = (n - 1) % 26
    letters = String.fromCharCode(65 + remainder) + letters
    n = Math.floor((n - 1) / 26)
  }
  return letters
}

async function main() {
  // The as-issued file is the source of truth. On the first run the template in
  // place is still the funder's own, so it becomes that record.
  try {
    await access(ORIGINAL)
  } catch {
    await copyFile(OUTPUT, ORIGINAL)
    console.log('kept the funder\'s file as tia-quarterly-financial-report-as-issued.xlsx')
  }

  const wb = new ExcelJS.Workbook()
  const bytes = await readFile(ORIGINAL)
  await wb.xlsx.load(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  )

  const ws = wb.getWorksheet(QUARTERLY)
  if (!ws) throw new Error('The workbook has no quarterly sheet.')

  const breakdown = wb.getWorksheet(BREAKDOWN)
  if (!breakdown) throw new Error('The workbook has no expenditure sheet.')

  const insertions: Insertion[] = SECTIONS.map((s) => ({
    after: s.lastRow,
    count: s.target - (s.lastRow - s.firstRow + 1),
  })).filter((i) => i.count > 0)

  // Bottom-up, so the rows still to be split keep the numbers they were
  // measured with.
  for (const insertion of [...insertions].sort((a, b) => b.after - a.after)) {
    ws.duplicateRow(insertion.after, insertion.count, true)
  }

  /* The expenditure sheet, widened the same way. Its TOTAL row carries the
     only formulas, and they are rewritten below rather than shifted: a sum
     ending on the old last data row would not reach the new rows, which is the
     quiet kind of wrong this whole script exists to avoid. */
  const totalRow = findTotalRow(breakdown)
  const breakdownLastData = totalRow - 1
  const breakdownExtra =
    BREAKDOWN_TARGET_ROWS - (breakdownLastData - BREAKDOWN_FIRST_DATA_ROW + 1)
  const breakdownInsertions: Insertion[] =
    breakdownExtra > 0 ? [{ after: breakdownLastData, count: breakdownExtra }] : []

  for (const insertion of breakdownInsertions) {
    breakdown.duplicateRow(insertion.after, insertion.count, true)
  }

  // Every formula in the workbook, including the three other sheets that point
  // into this one. The text still names the old rows at this point, because
  // inserting rows moves cells without rewriting what refers to them.
  const bySheet = { [QUARTERLY]: insertions, [BREAKDOWN]: breakdownInsertions }
  wb.eachSheet((sheet) => {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const value = cell.value
        if (typeof value !== 'object' || value === null || !('formula' in value)) return
        const formula = (value as ExcelJS.CellFormulaValue).formula
        if (typeof formula !== 'string') return
        cell.value = {
          formula: shiftFormula(formula, sheet.name, bySheet),
          // The cached result belonged to the row this formula used to read.
          // Dropped, and the workbook is marked for a full recalculation.
          result: undefined,
        } as ExcelJS.CellFormulaValue
      })
    })
  })

  /* Each section's rows, in the new coordinates, written out cleanly. The
     duplicated rows carry a copy of their model row's formulas, which point at
     the model row; every one is replaced with the row's own. */
  const shift = (row: number) => shiftedRow(row, insertions)

  for (const section of SECTIONS) {
    const first = shift(section.firstRow)
    const last = first + section.target - 1
    const heading = shift(section.headingRow)

    for (let row = first; row <= last; row++) {
      ws.getCell(row, 1).value = null
      ws.getCell(row, 2).value = 0
      ws.getCell(row, 3).value = 0
      ws.getCell(row, 4).value = { formula: `B${row}-C${row}` } as ExcelJS.CellFormulaValue
      // Percentage variance is left as a typed zero, the way the funder's own
      // unfilled rows are. Dividing by a budget of nothing would put #DIV/0!
      // into a report; the exporter writes the formula only where a row is
      // used and has a budget.
      ws.getCell(row, 5).value = 0
      ws.getCell(row, 6).value = null
      ws.getCell(row, 7).value = null
    }

    // The section subtotal, covering the section and nothing else. Consumables
    // had a typed zero here, which is why its rows counted for nothing.
    ws.getCell(heading, 2).value = { formula: `SUM(B${first}:B${last})` } as ExcelJS.CellFormulaValue
    ws.getCell(heading, 3).value = { formula: `SUM(C${first}:C${last})` } as ExcelJS.CellFormulaValue
    ws.getCell(heading, 4).value = { formula: `B${heading}-C${heading}` } as ExcelJS.CellFormulaValue

    console.log(
      `${section.name}: rows ${first} to ${last} (${section.target}), subtotal on row ${heading}`
    )
  }

  /* The expenditure sheet's rows and total. The duplicated rows carry a copy of
     the last transaction on the sheet, which the exporter would clear anyway -
     but a template that ships with a hundred copies of the same bank line is a
     template somebody will send to a funder by mistake. */
  if (breakdownInsertions.length > 0) {
    const newTotalRow = shiftedRow(totalRow, breakdownInsertions)
    const lastData = newTotalRow - 1
    for (let row = BREAKDOWN_FIRST_DATA_ROW; row <= lastData; row++) {
      for (let col = 1; col <= 12; col++) breakdown.getCell(row, col).value = null
    }
    for (const col of BREAKDOWN_TOTAL_COLUMNS) {
      const letter = columnLetter(col)
      breakdown.getCell(newTotalRow, col).value = {
        // Starting at row 1 as the funder's own total does. The header rows
        // above are text, which SUM ignores.
        formula: `SUM(${letter}1:${letter}${lastData})`,
      } as ExcelJS.CellFormulaValue
    }
    console.log(
      `Expenditure: rows ${BREAKDOWN_FIRST_DATA_ROW} to ${lastData} (${lastData - BREAKDOWN_FIRST_DATA_ROW + 1}), total on row ${newTotalRow}`
    )
  }

  wb.calcProperties.fullCalcOnLoad = true

  const out = await wb.xlsx.writeBuffer()
  await writeFile(OUTPUT, Buffer.from(out as ArrayBuffer))
  console.log(`\nwrote ${OUTPUT}`)
  console.log('Update QUARTERLY_CATEGORY_BANDS in lib/finance/workbook-schema.ts to match.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
