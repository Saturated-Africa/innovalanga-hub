import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shiftFormula, shiftedRow } from './shift-formula'

const QUARTERLY = 'Quarterly financial'
const ACCUMULATED = 'Accumulated financial info'

// Twenty rows inserted after row 41, then ten after row 43 in the original
// numbering - the shape the real widening takes.
const sheets = {
  [QUARTERLY]: [
    { after: 41, count: 20 },
    { after: 43, count: 10 },
  ],
}

test('a row above every insertion does not move', () => {
  assert.equal(shiftedRow(19, sheets[QUARTERLY]), 19)
  assert.equal(shiftedRow(41, sheets[QUARTERLY]), 41)
})

test('a row below an insertion moves by its count', () => {
  assert.equal(shiftedRow(42, sheets[QUARTERLY]), 62)
})

test('a row below two insertions moves by both', () => {
  assert.equal(shiftedRow(44, sheets[QUARTERLY]), 74)
  assert.equal(shiftedRow(50, sheets[QUARTERLY]), 80)
})

test('a reference above the insertion is left alone', () => {
  assert.equal(shiftFormula('=SUM(B19:B41)', QUARTERLY, sheets), '=SUM(B19:B41)')
})

test('a reference below the insertion moves', () => {
  assert.equal(shiftFormula('=B18+B42+B44+B48', QUARTERLY, sheets), '=B18+B62+B74+B78')
})

test('a range straddling an insertion keeps its start and moves its end', () => {
  assert.equal(shiftFormula('=SUM(C18:C50)', QUARTERLY, sheets), '=SUM(C18:C80)')
})

test('a qualified reference follows the sheet it names, not the one it sits on', () => {
  assert.equal(
    shiftFormula("='Quarterly financial'!C50-15499", 'Bank and cash reconciliation', sheets),
    "='Quarterly financial'!C50-15499".replace('C50', 'C80')
  )
})

test('a bare number in a formula is not a row reference', () => {
  assert.equal(
    shiftFormula("='Quarterly financial'!C50-15499", 'Bank and cash reconciliation', sheets),
    "='Quarterly financial'!C80-15499"
  )
})

test('a sheet with no insertions is untouched', () => {
  assert.equal(shiftFormula('=B42-C42', ACCUMULATED, sheets), '=B42-C42')
})

test('each sheet takes its own insertions', () => {
  const both = {
    [QUARTERLY]: [{ after: 41, count: 20 }],
    [ACCUMULATED]: [{ after: 35, count: 5 }],
  }
  assert.equal(
    shiftFormula("=B42-'Quarterly financial'!C42", ACCUMULATED, both),
    "=B47-'Quarterly financial'!C62"
  )
})

test('absolute rows move too, because insertion is not copying', () => {
  assert.equal(shiftFormula('=$B$42', QUARTERLY, sheets), '=$B$62')
})

test('a row number inside a longer name is not rewritten', () => {
  assert.equal(shiftFormula('=TAX_A42', QUARTERLY, sheets), '=TAX_A42')
})

test('multi-letter columns are handled', () => {
  assert.equal(shiftFormula('=SUM(AA42:AB44)', QUARTERLY, sheets), '=SUM(AA62:AB74)')
})

test('a formula with no references is returned unchanged', () => {
  assert.equal(shiftFormula('=1+2', QUARTERLY, sheets), '=1+2')
})

test('both ends of a qualified range follow the sheet it names', () => {
  assert.equal(
    shiftFormula("=SUM('Quarterly financial'!C51:C52)", 'Next Quarter Projection', sheets),
    "=SUM('Quarterly financial'!C81:C82)"
  )
})

test('a local range moves both ends', () => {
  assert.equal(shiftFormula('=SUM(B42:B50)', QUARTERLY, sheets), '=SUM(B62:B80)')
})

test('a range on a sheet with no insertions is untouched', () => {
  assert.equal(shiftFormula('=SUM(B42:B50)', ACCUMULATED, sheets), '=SUM(B42:B50)')
})
