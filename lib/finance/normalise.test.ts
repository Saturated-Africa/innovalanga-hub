import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normaliseActivityCode,
  parseAmount,
  amountOrZero,
  parseSheetDate,
  parseProofLink,
  parseMonthOffset,
  tidyText,
} from './normalise.ts'

/**
 * These all exist because of what the real workbook contains. Every odd case
 * below was taken from the funder's own file rather than invented.
 */

test('activity codes collapse repeated separators', () => {
  // Both of these are in the sample sheet.
  assert.equal(normaliseActivityCode('3..2'), '3.2')
  assert.equal(normaliseActivityCode('3.2..1'), '3.2.1')
  assert.equal(normaliseActivityCode(' 1.1.1 '), '1.1.1')
})

test('two spellings of one code normalise to the same identifier', () => {
  // The consequence of not doing this is a budget silently split in half.
  assert.equal(normaliseActivityCode('3..2'), normaliseActivityCode('3.2'))
})

test('an empty activity code is null, not an empty string', () => {
  assert.equal(normaliseActivityCode(''), null)
  assert.equal(normaliseActivityCode('   '), null)
  assert.equal(normaliseActivityCode(null), null)
  assert.equal(normaliseActivityCode('...'), null)
})

test('amounts parse from numbers, text and accounting notation', () => {
  assert.equal(parseAmount(1234.5), 1234.5)
  assert.equal(parseAmount('1234.50'), 1234.5)
  assert.equal(parseAmount('R 1 234,50'.replace(',', '.')), 1234.5)
  assert.equal(parseAmount('R21000'), 21000)
  assert.equal(parseAmount('(500)'), -500, 'parentheses mean negative')
})

test('a blank amount is null, and null is not zero', () => {
  // A blank budget cell and a budget of zero mean different things on a
  // variance report, so they must not collapse into one value.
  assert.equal(parseAmount(''), null)
  assert.equal(parseAmount(null), null)
  assert.equal(parseAmount(undefined), null)
  assert.equal(amountOrZero(''), 0, 'but a spend column treats blank as nothing spent')
})

test('nonsense in an amount cell is rejected rather than coerced', () => {
  assert.equal(parseAmount('As Per Bank Statement'), null)
  assert.equal(parseAmount('n/a'), null)
})

test('dates parse from the sheet format and from real dates', () => {
  const d = parseSheetDate('23-Feb-2024')
  assert.ok(d)
  assert.equal(d.getUTCFullYear(), 2024)
  assert.equal(d.getUTCMonth(), 1)
  assert.equal(d.getUTCDate(), 23)

  const already = new Date(Date.UTC(2024, 5, 1))
  assert.equal(parseSheetDate(already)?.getTime(), already.getTime())
  assert.equal(parseSheetDate(''), null)
})

test('a proof cell that is a note is not treated as a link', () => {
  // "As Per Bank Statement" fills much of the sample's proof column. Treating
  // it as a URL would produce a workbook full of dead links.
  assert.deepEqual(parseProofLink('As Per Bank Statement'), {
    url: null,
    note: 'As Per Bank Statement',
  })
  assert.deepEqual(parseProofLink('https://drive.google.com/file/d/abc'), {
    url: 'https://drive.google.com/file/d/abc',
    note: null,
  })
  assert.deepEqual(parseProofLink(''), { url: null, note: null })
})

test('month offsets come out of "Month 3" style text', () => {
  assert.equal(parseMonthOffset('Month 3'), 3)
  assert.equal(parseMonthOffset('Month 12'), 12)
  assert.equal(parseMonthOffset(2), 2)
  assert.equal(parseMonthOffset(''), null)
})

test('text is collapsed rather than carried with sheet line breaks', () => {
  assert.equal(tidyText('  Develop a\n  stakholder map '), 'Develop a stakholder map')
  assert.equal(tidyText(''), null)
})
