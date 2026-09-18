/**
 * Dry-run a funder workbook import.
 *
 *   npx tsx scripts/import-finance-workbook.ts "path/to/workbook.xlsx"
 *
 * Parses only and writes nothing. The point is to see what a file yields, and
 * what is wrong with it, before any of it reaches the database.
 */
import { readFileSync } from 'node:fs'
import { importWorkbook } from '../lib/finance/import-workbook'

const money = (n: number) =>
  n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const path = process.argv[2]
if (!path) {
  console.error('usage: tsx scripts/import-finance-workbook.ts <workbook.xlsx>')
  process.exit(2)
}

async function main() {
    const result = await importWorkbook(readFileSync(path))
  console.log('\nAGREEMENT')
  for (const [k, v] of Object.entries(result.project)) {
    console.log(`   ${k.padEnd(18)} ${v === null ? '—' : typeof v === 'number' ? money(v) : v}`)
  }

  console.log('\nWHAT WOULD BE CREATED')
  console.log(`   activities         ${result.activities.length}`)
  console.log(`   transactions       ${result.totals.transactionCount}`)
  console.log(`   transaction total  ${money(result.totals.transactionTotal)}`)
  console.log(`   budget total       ${money(result.totals.budgetTotal)}`)
  console.log(`   uncategorised rows ${result.totals.uncategorised}`)

  const byCategory = new Map<string, number>()
  for (const t of result.transactions) {
    byCategory.set(t.costCategory, (byCategory.get(t.costCategory) ?? 0) + t.amount)
  }
  console.log('\nSPEND BY CATEGORY')
  for (const [cat, total] of Array.from(byCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${cat.padEnd(18)} ${money(total)}`)
  }

  console.log('\nPROOF ALREADY IN THE SHEET')
  console.log(`   invoice links      ${result.transactions.filter((t) => t.invoiceLink).length}`)
  console.log(`   payment links      ${result.transactions.filter((t) => t.popLink).length}`)
  console.log(`   note, not a link   ${result.transactions.filter((t) => !t.popLink && t.proofNote).length}`)

  const errors = result.problems.filter((p) => p.severity === 'error')
  const warnings = result.problems.filter((p) => p.severity === 'warning')
  console.log(`\nPROBLEMS   ${errors.length} errors, ${warnings.length} warnings`)
  for (const p of [...errors, ...warnings].slice(0, 12)) {
    console.log(`   [${p.severity}] ${p.sheet} row ${p.row ?? '-'}`)
    console.log(`           ${p.message}`)
  }
  if (result.problems.length > 12) console.log(`   ... and ${result.problems.length - 12} more`)

}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})