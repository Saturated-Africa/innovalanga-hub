import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as ExcelJS from 'exceljs'
import { importWorkbook } from './import-workbook.ts'
import { SHEETS, PROJECT_PLAN, BREAKDOWN, RECONCILIATION } from './workbook-schema.ts'

/**
 * Built against a synthetic workbook rather than the real one, because the real
 * file holds the organisation's actual financial records and does not belong in
 * a repository. Every case below reproduces something the real file does.
 */

interface PlanRow {
  milestone?: string
  workPackage?: string
  code?: string
  details?: string
  q1?: number
}

interface SpendRow {
  date?: string
  supplier?: string
  description?: string
  amount?: number
  personnelCol?: number
  capitalCol?: number
  popCell?: string
}

async function buildWorkbook(opts: {
  plan?: PlanRow[]
  spend?: SpendRow[]
  quarterly?: string[]
  statedExpenses?: number
  institutionCell?: string
}): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()

  const plan = wb.addWorksheet(SHEETS.projectPlan)
  const pc = PROJECT_PLAN.col
  opts.plan?.forEach((r, i) => {
    const row = PROJECT_PLAN.firstDataRow + i
    if (r.milestone) plan.getCell(row, pc.milestone).value = r.milestone
    if (r.workPackage) plan.getCell(row, pc.workPackage).value = r.workPackage
    if (r.code) plan.getCell(row, pc.activityNo).value = r.code
    if (r.details) plan.getCell(row, pc.details).value = r.details
    if (r.q1 !== undefined) plan.getCell(row, pc.budgetQ1).value = r.q1
  })

  const spend = wb.addWorksheet(SHEETS.breakdown)
  const bc = BREAKDOWN.col
  opts.spend?.forEach((r, i) => {
    const row = BREAKDOWN.firstDataRow + i
    if (r.date) spend.getCell(row, bc.date).value = r.date
    if (r.supplier) spend.getCell(row, bc.supplier).value = r.supplier
    if (r.description) spend.getCell(row, bc.description).value = r.description
    if (r.amount !== undefined) spend.getCell(row, bc.amount).value = r.amount
    if (r.personnelCol !== undefined) spend.getCell(row, bc.personnel).value = r.personnelCol
    if (r.capitalCol !== undefined) spend.getCell(row, bc.capital1).value = r.capitalCol
    if (r.popCell) spend.getCell(row, bc.popLink).value = r.popCell
  })

  const q = wb.addWorksheet(SHEETS.quarterly)
  opts.quarterly?.forEach((label, i) => {
    q.getCell(i + 1, 1).value = label
  })

  const rec = wb.addWorksheet(SHEETS.reconciliation)
  rec.getCell(RECONCILIATION.institutionRow, 2).value =
    opts.institutionCell ?? 'Test Academy'
  if (opts.statedExpenses !== undefined) {
    rec.getCell(RECONCILIATION.expensesRow, RECONCILIATION.valueCol).value = opts.statedExpenses
  }

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}

test('subtotal and grand total rows never become activities', async () => {
  // The real sheet puts "Sub-Total 1" and "Grand Total (Sub-Total 1 +2+3+4+5)"
  // in the activity number column. Importing those would count every budget
  // beneath them a second time.
  const buf = await buildWorkbook({
    plan: [
      { code: '1.1.1', details: 'Understand project objectives', q1: 1000 },
      { code: '1.1.2', details: 'Sign contracts', q1: 500 },
      { code: 'Sub-Total 1', details: 'Sub total', q1: 1500 },
      { code: 'Grand Total (Sub-Total 1 +2)', details: 'Grand total', q1: 1500 },
    ],
  })
  const r = await importWorkbook(buf)

  assert.equal(r.activities.length, 2)
  assert.deepEqual(r.activities.map((a) => a.code), ['1.1.1', '1.1.2'])
  assert.equal(r.totals.budgetTotal, 1500, 'the subtotal must not be added again')
})

test('doubled separators in activity codes are normalised and reported', async () => {
  const buf = await buildWorkbook({
    plan: [{ code: '3.2..1', details: 'Schedule training sessions', q1: 100 }],
  })
  const r = await importWorkbook(buf)

  assert.equal(r.activities[0].code, '3.2.1')
  assert.ok(
    r.problems.some((p) => p.severity === 'warning' && p.message.includes('3.2..1')),
    'the operator should be told the code was changed'
  )
})

test('a code appearing twice keeps the first and reports the clash', async () => {
  const buf = await buildWorkbook({
    plan: [
      { code: '2.1', details: 'First use', q1: 100 },
      { code: '2.1', details: 'Second use', q1: 900 },
    ],
  })
  const r = await importWorkbook(buf)

  assert.equal(r.activities.length, 1)
  assert.equal(r.activities[0].details, 'First use')
  assert.equal(r.totals.budgetTotal, 100)
  assert.ok(r.problems.some((p) => p.severity === 'error' && p.message.includes('2.1')))
})

test('cost category comes from the heading above an activity', async () => {
  const buf = await buildWorkbook({
    plan: [
      { code: '1.1', details: 'Hire staff' },
      { code: '4.1', details: 'Buy tablets' },
    ],
    quarterly: [
      'PERSONNEL COSTS:',
      '1.1 Hire staff',
      'CAPITAL EQUIPMENT:',
      '4.1 Buy tablets',
    ],
  })
  const r = await importWorkbook(buf)

  assert.equal(r.activities.find((a) => a.code === '1.1')?.costCategory, 'Personnel')
  assert.equal(r.activities.find((a) => a.code === '4.1')?.costCategory, 'CapitalEquipment')
})

test('a TOTAL row at the foot of the breakdown is not a transaction', async () => {
  const buf = await buildWorkbook({
    spend: [
      { date: '23-Feb-2024', supplier: 'Bank', description: 'Charges', amount: 55, personnelCol: 55 },
      { supplier: 'TOTAL', description: 'TOTAL', amount: 55 },
    ],
  })
  const r = await importWorkbook(buf)

  assert.equal(r.totals.transactionCount, 1, 'the total row has no date and is skipped')
  assert.equal(r.totals.transactionTotal, 55, 'and must not double the total')
  assert.ok(r.problems.some((p) => p.severity === 'error' && p.row === BREAKDOWN.firstDataRow + 1))
})

test('a proof cell holding a note is not stored as a link', async () => {
  const buf = await buildWorkbook({
    spend: [
      { date: '23-Feb-2024', supplier: 'A', amount: 10, personnelCol: 10, popCell: 'As Per Bank Statement' },
      { date: '24-Feb-2024', supplier: 'B', amount: 20, personnelCol: 20, popCell: 'https://example.org/pop.pdf' },
    ],
  })
  const r = await importWorkbook(buf)

  assert.equal(r.transactions[0].popLink, null)
  assert.equal(r.transactions[0].proofNote, 'As Per Bank Statement')
  assert.equal(r.transactions[1].popLink, 'https://example.org/pop.pdf')
  assert.equal(r.transactions[1].proofNote, null)
})

test('a transaction total that disagrees with the reconciliation is flagged', async () => {
  // Exactly the condition found in the real file: the breakdown and the
  // reconciliation sheet disagreed by the value of one transaction.
  const buf = await buildWorkbook({
    spend: [
      { date: '23-Feb-2024', supplier: 'A', amount: 100, personnelCol: 100 },
      { date: '24-Feb-2024', supplier: 'B', amount: 50, personnelCol: 50 },
    ],
    statedExpenses: 100,
  })
  const r = await importWorkbook(buf)

  assert.equal(r.totals.transactionTotal, 150)
  assert.ok(
    r.problems.some((p) => p.message.includes('150.00') && p.message.includes('100.00')),
    'the operator must be told the two sheets disagree'
  )
})

test('an amount allocated to a category that differs from the invoice is flagged', async () => {
  const buf = await buildWorkbook({
    spend: [{ date: '23-Feb-2024', supplier: 'A', amount: 500, capitalCol: 400 }],
  })
  const r = await importWorkbook(buf)

  assert.ok(r.problems.some((p) => p.severity === 'warning' && p.message.includes('does not match')))
})

test('a workbook that is not the template reports it rather than importing nothing quietly', async () => {
  const wb = new ExcelJS.Workbook()
  wb.addWorksheet('Some other sheet')
  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer

  const r = await importWorkbook(buf)
  assert.equal(r.activities.length, 0)
  assert.ok(r.problems.some((p) => p.severity === 'error' && p.message.includes('not be the funder template')))
})

test('a header cell that repeats its own label yields only the value', () => {
  // The real file stores "Name of Institution: ABC Academy" in a single cell.
  // Left unstripped, that whole string becomes the institution name printed at
  // the top of the funder's report.
  return buildWorkbook({ institutionCell: 'Name of Institution: ABC Academy' })
    .then(importWorkbook)
    .then((r) => {
      assert.equal(r.project.institutionName, 'ABC Academy')
    })
})

test('a header cell with no label prefix is taken as-is', () => {
  return buildWorkbook({ institutionCell: 'Saturated Africa' })
    .then(importWorkbook)
    .then((r) => {
      assert.equal(r.project.institutionName, 'Saturated Africa')
    })
})

test('a hyperlink whose text is rich text reads as its words', () => {
  // This produced a supplier literally named "[object Object]" in the real
  // import, which would have been printed on a funder's report.
  return (async () => {
    const wb = new ExcelJS.Workbook()
    const plan = wb.addWorksheet(SHEETS.projectPlan)
    plan.getCell(PROJECT_PLAN.firstDataRow, PROJECT_PLAN.col.activityNo).value = '1.1'
    plan.getCell(PROJECT_PLAN.firstDataRow, PROJECT_PLAN.col.details).value = 'Anything'

    const spend = wb.addWorksheet(SHEETS.breakdown)
    const r = BREAKDOWN.firstDataRow
    spend.getCell(r, BREAKDOWN.col.date).value = '26-Feb-2024'
    // The shape ExcelJS produces for a linked, styled cell.
    spend.getCell(r, BREAKDOWN.col.supplier).value = {
      text: { richText: [{ text: 'POS Purchase ' }, { text: 'Apple.Com' }] },
      hyperlink: 'https://example.org',
    } as never
    spend.getCell(r, BREAKDOWN.col.amount).value = 59.99
    spend.getCell(r, BREAKDOWN.col.personnel).value = 59.99

    wb.addWorksheet(SHEETS.quarterly)
    wb.addWorksheet(SHEETS.reconciliation)

    const result = await importWorkbook((await wb.xlsx.writeBuffer()) as ArrayBuffer)
    assert.equal(result.transactions[0].supplier, 'POS Purchase Apple.Com')
    assert.ok(!result.transactions[0].supplier.includes('object Object'))
  })()
})
