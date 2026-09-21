import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prefillValue } from './prefill'

/**
 * The stale-prefill case is why this is a function with tests rather than three
 * lines inside a change handler. Pick the wrong participant, notice, pick the
 * right one - and a form that only fills empty fields keeps the first
 * participant's registration number, which then reaches a grant agreement looking
 * entirely plausible because it is a real number belonging to a real company.
 */

test('fills an empty field', () => {
  assert.equal(prefillValue('', null, '2016/123456/07'), '2016/123456/07')
})

test('replaces a value that came from the previous selection', () => {
  assert.equal(
    prefillValue('2016/123456/07', '2016/123456/07', '2021/987654/08'),
    '2021/987654/08'
  )
})

test('leaves alone anything a person typed', () => {
  assert.equal(
    prefillValue('2099/000001/07', '2016/123456/07', '2021/987654/08'),
    '2099/000001/07'
  )
})

test('an absent new value clears a stale one rather than keeping it', () => {
  // The newly selected participant has no registered entity. Keeping the previous
  // one's number would attribute one company's registration to another person.
  assert.equal(prefillValue('2016/123456/07', '2016/123456/07', null), '')
})

test('an absent new value does not clear something typed', () => {
  assert.equal(prefillValue('typed by hand', '2016/123456/07', null), 'typed by hand')
})

test('an empty field with no new value stays empty', () => {
  assert.equal(prefillValue('', null, null), '')
  assert.equal(prefillValue('', undefined, undefined), '')
})

test('treats null and empty string as the same previous value', () => {
  // A record with no entity supplies null; the field holds "". They mean the same
  // thing here, and a mismatch would make the field un-fillable.
  assert.equal(prefillValue('', '', 'x'), 'x')
  assert.equal(prefillValue('', null, 'x'), 'x')
})
