/**
 * Cleaning the values that come out of the funder's workbook.
 *
 * The sheets are filled in by hand over a year, so the data arrives with the
 * marks of that: activity codes typed as "3..2" and "3.2..1", amounts stored
 * as text, dates as strings, and a proof column that sometimes holds a URL and
 * sometimes the words "As Per Bank Statement".
 *
 * None of that is a reason to reject a row. It is a reason to normalise it and
 * say what was changed, which is what these functions do. Dependency-free so
 * the rules can be tested directly.
 */

/**
 * Turn an activity code into a stable identifier.
 *
 * Repeated separators collapse and stray whitespace goes, so "3..2" and
 * "3.2..1 " become "3.2" and "3.2.1". The platform reconciles transactions to
 * activities by this value, so two spellings of one code would split a budget
 * in half without anybody noticing.
 */
export function normaliseActivityCode(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const text = String(raw).trim()
  if (!text) return null

  const cleaned = text
    .replace(/\s+/g, '')
    .replace(/[.]{2,}/g, '.')
    .replace(/^[.]+|[.]+$/g, '')

  return cleaned || null
}

/**
 * Read a money value that may be a number, a formatted string, or blank.
 *
 * Returns null rather than zero when there is nothing there: a blank budget
 * cell and a budget of zero mean different things on a variance report.
 */
export function parseAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null

  const text = String(raw).trim()
  if (!text) return null

  // Accounting notation: parentheses mean negative.
  const negative = /^\(.*\)$/.test(text)
  const digits = text.replace(/[()]/g, '').replace(/[R\s,]/gi, '')
  if (!/^-?\d*\.?\d+$/.test(digits)) return null

  const value = Number(digits)
  if (!Number.isFinite(value)) return null
  return negative ? -Math.abs(value) : value
}

/** Amount, defaulting a blank to zero. For columns where blank means nothing spent. */
export function amountOrZero(raw: unknown): number {
  return parseAmount(raw) ?? 0
}

/**
 * Read a date that may already be a Date, or a string such as "23-Feb-2024".
 */
export function parseSheetDate(raw: unknown): Date | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw
  if (raw === null || raw === undefined) return null

  const text = String(raw).trim()
  if (!text) return null

  const dmy = text.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,})[-/\s](\d{4})$/)
  if (dmy) {
    const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
    const month = months.indexOf(dmy[2].slice(0, 3).toLowerCase())
    if (month >= 0) {
      return new Date(Date.UTC(Number(dmy[3]), month, Number(dmy[1])))
    }
  }

  const iso = Date.parse(text)
  return Number.isNaN(iso) ? null : new Date(iso)
}

/**
 * Whether a proof cell actually points at something.
 *
 * "As Per Bank Statement" appears throughout the sample. It is a note, not a
 * link, and treating it as one would produce a workbook full of broken URLs.
 */
export function parseProofLink(raw: unknown): { url: string | null; note: string | null } {
  if (raw === null || raw === undefined) return { url: null, note: null }
  const text = String(raw).trim()
  if (!text) return { url: null, note: null }

  if (/^https?:\/\//i.test(text)) return { url: text, note: null }
  return { url: null, note: text }
}

/**
 * Which month of the project a "Month 3" style value refers to.
 */
export function parseMonthOffset(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  const match = String(raw).match(/(\d+)/)
  return match ? Number(match[1]) : null
}

/** Collapse whitespace and trim. Sheet text is full of stray newlines. */
export function tidyText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const text = String(raw).replace(/\s+/g, ' ').trim()
  return text || null
}
