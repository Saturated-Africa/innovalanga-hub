import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as ExcelJS from 'exceljs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  SHEETS,
  QUARTERLY,
  QUARTERLY_CATEGORY_BANDS,
  BREAKDOWN,
  PROJECT_PLAN,
} from './workbook-schema'

/**
 * The geometry constants against the template they describe.
 *
 * Every number in `workbook-schema.ts` is a row or column in a file nobody
 * reads by hand, and the export writes into them without looking. A heading
 * that has moved by one row puts a quarter of somebody's expenditure under the
 * wrong cost category, and nothing about that fails loudly. So the constants
 * are checked against the file itself, and a reissued template that does not
 * match them fails here rather than in front of a funder.
 */

const TEMPLATE = path.join(process.cwd(), 'lib/finance/templates/tia-quarterly-financial-report.xlsx')

async function load(): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  const bytes = await readFile(TEMPLATE)
  await wb.xlsx.load(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  )
  return wb
}

/**
 * The text of a cell, whatever shape the file holds it in.
 *
 * A label the funder typed with a line break inside it comes back as rich text
 * rather than a string, and stringifying that gives "[object Object]" - which
 * matches no expectation and reads like a missing row rather than a formatting
 * detail.
 */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'richText' in value) {
    return (value as ExcelJS.CellRichTextValue).richText.map((part) => part.text).join('')
  }
  return String(value)
}

const HEADING_TEXT: Record<string, RegExp> = {
  Personnel: /^PERSONNEL COSTS/i,
  Operational: /^OPERATIONAL COST/i,
  CapitalEquipment: /^CAPITAL EQUIPMENT/i,
  Consumables: /^CONSUMABLES/i,
}

test('every sheet the platform names exists in the template', async () => {
  const wb = await load()
  for (const name of Object.values(SHEETS)) {
    assert.ok(wb.getWorksheet(name), `missing sheet "${name}"`)
  }
})

test('each category heading sits on the row the schema claims', async () => {
  const wb = await load()
  const ws = wb.getWorksheet(SHEETS.quarterly)!
  for (const band of QUARTERLY_CATEGORY_BANDS) {
    const label = cellText(ws.getCell(band.headingRow, QUARTERLY.col.label).value)
    assert.match(label, HEADING_TEXT[band.category])
  }
})

test('each subtotal sums its own band, and nothing else', async () => {
  const wb = await load()
  const ws = wb.getWorksheet(SHEETS.quarterly)!
  for (const band of QUARTERLY_CATEGORY_BANDS) {
    for (const [column, letter] of [
      [QUARTERLY.col.budget, 'B'],
      [QUARTERLY.col.actual, 'C'],
    ] as const) {
      const cell = ws.getCell(band.headingRow, column)
      const value = cell.value as ExcelJS.CellFormulaValue
      assert.ok(
        typeof value === 'object' && value !== null && 'formula' in value,
        `${band.category} ${letter} subtotal is not a formula`
      )
      assert.equal(
        value.formula.replace(/\s/g, ''),
        `SUM(${letter}${band.firstRow}:${letter}${band.lastRow})`,
        `${band.category} ${letter} subtotal does not cover its band`
      )
    }
  }
})

test('the bands do not overlap and run in order', async () => {
  const sorted = [...QUARTERLY_CATEGORY_BANDS].sort((a, b) => a.firstRow - b.firstRow)
  for (let i = 0; i < sorted.length; i++) {
    assert.ok(sorted[i].headingRow < sorted[i].firstRow, `${sorted[i].category} heading is inside its band`)
    assert.ok(sorted[i].firstRow <= sorted[i].lastRow, `${sorted[i].category} band is empty`)
    if (i > 0) {
      assert.ok(
        sorted[i - 1].lastRow < sorted[i].headingRow,
        `${sorted[i - 1].category} runs into ${sorted[i].category}`
      )
    }
  }
})

test('the declaration rows carry the labels the export writes into', async () => {
  const wb = await load()
  const ws = wb.getWorksheet(SHEETS.quarterly)!
  const d = QUARTERLY.declaration
  assert.match(cellText(ws.getCell(d.preparedByRow, 1).value), /prepared by/i)
  assert.match(cellText(ws.getCell(d.preparedDateRow, 1).value), /^date/i)
  assert.match(cellText(ws.getCell(d.approvedByRow, 1).value), /approved by/i)
  assert.match(cellText(ws.getCell(d.approvedDateRow, 1).value), /^date/i)
})

test('the income rows are the ones the export writes into', async () => {
  const wb = await load()
  const ws = wb.getWorksheet(SHEETS.quarterly)!
  assert.match(
    cellText(ws.getCell(QUARTERLY.income.balanceBroughtForwardRow, 1).value),
    /balance brought forward/i
  )
  assert.match(cellText(ws.getCell(QUARTERLY.income.fundingRow, 1).value), /funding/i)
  assert.ok(QUARTERLY.income.otherFirstRow > QUARTERLY.income.fundingRow)
  assert.ok(QUARTERLY.income.otherLastRow >= QUARTERLY.income.otherFirstRow)
})

test('the expenditure sheet still starts where the schema says', async () => {
  const wb = await load()
  const ws = wb.getWorksheet(SHEETS.breakdown)!
  // The row above the first data row belongs to the header block.
  assert.ok(BREAKDOWN.firstDataRow >= 2)
  const header = cellText(ws.getCell(BREAKDOWN.firstDataRow - 1, BREAKDOWN.col.amount).value)
  assert.notEqual(header.trim(), '', 'no header above the first data row')
})

test('the project plan sheet still starts where the schema says', async () => {
  const wb = await load()
  const ws = wb.getWorksheet(SHEETS.projectPlan)!
  assert.ok(PROJECT_PLAN.firstDataRow >= 2)
  assert.ok(ws.rowCount > PROJECT_PLAN.firstDataRow)
})
