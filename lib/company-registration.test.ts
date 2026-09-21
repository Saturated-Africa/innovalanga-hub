import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseRegistrationNumber,
  checkRegistration,
  isRegisteredType,
  REGISTERED_ENTITY_TYPES,
} from './company-registration'

/**
 * The test that earns its place is the mismatch one. A registration number's last
 * two digits say what kind of entity it is, so a number ending /07 against an
 * entity type of NPC means somebody mistyped one of them - and both end up on a
 * grant agreement and a funder's report.
 */

const TODAY = new Date('2026-09-19T00:00:00.000Z')

test('parses a private company number', () => {
  const r = parseRegistrationNumber('2016/123456/07', TODAY)
  assert.equal(r.ok, true)
  assert.equal(r.normalised, '2016/123456/07')
  assert.equal(r.year, 2016)
  assert.equal(r.suffix, '07')
  assert.equal(r.entityType, 'PtyLtd')
  assert.match(r.label ?? '', /private company/)
})

test('parses a non-profit company number', () => {
  const r = parseRegistrationNumber('2021/987654/08', TODAY)
  assert.equal(r.ok, true)
  assert.equal(r.entityType, 'NPC')
  assert.match(r.label ?? '', /non-profit/)
})

test('tolerates spaces and a CK prefix from an old certificate', () => {
  // Close corporations registered before 2008 are written CK1998/012345/23 on
  // the certificate. Somebody copying one faithfully should not be told it is
  // malformed.
  assert.equal(parseRegistrationNumber('CK1998/012345/23', TODAY).ok, true)
  assert.equal(
    parseRegistrationNumber(' 2016 / 123456 / 07 ', TODAY).normalised,
    '2016/123456/07'
  )
})

test('accepts a seven digit sequence', () => {
  assert.equal(parseRegistrationNumber('2023/1234567/07', TODAY).ok, true)
})

test('refuses something that is not in the shape at all', () => {
  for (const bad of ['123456', '2016-123456-07', 'Pty Ltd', '2016/123456']) {
    const r = parseRegistrationNumber(bad, TODAY)
    assert.equal(r.ok, false, bad)
    assert.match(r.error ?? '', /2016\/123456\/07|registration number/)
  }
})

test('refuses an empty value with a useful message', () => {
  const r = parseRegistrationNumber('   ', TODAY)
  assert.equal(r.ok, false)
  assert.match(r.error ?? '', /certificate/)
})

test('refuses a year in the future or absurdly old', () => {
  assert.equal(parseRegistrationNumber('2027/123456/07', TODAY).ok, false)
  assert.equal(parseRegistrationNumber('1899/123456/07', TODAY).ok, false)
  // This year is fine: a company registered last week is a common case.
  assert.equal(parseRegistrationNumber('2026/123456/07', TODAY).ok, true)
})

test('refuses a suffix CIPC does not issue', () => {
  const r = parseRegistrationNumber('2016/123456/99', TODAY)
  assert.equal(r.ok, false)
  assert.match(r.error ?? '', /last two digits/)
})

test('accepts a number that matches the declared entity type', () => {
  assert.equal(checkRegistration('2016/123456/07', 'PtyLtd', TODAY).ok, true)
  assert.equal(checkRegistration('2021/987654/08', 'NPC', TODAY).ok, true)
})

test('refuses a number whose type contradicts the selection, naming both', () => {
  const r = checkRegistration('2016/123456/07', 'NPC', TODAY)
  assert.equal(r.ok, false)
  assert.equal(r.mismatch, true)
  assert.match(r.error ?? '', /private company/)
  assert.match(r.error ?? '', /non-profit/)
  assert.match(r.error ?? '', /one of the two is wrong/i)
})

test('a valid type this platform has no enum for is accepted as Other', () => {
  // A public company is a real registration; refusing it because a dropdown is
  // short would be our problem presented as theirs.
  assert.equal(checkRegistration('2016/123456/06', 'Other', TODAY).ok, true)

  const asPty = checkRegistration('2016/123456/06', 'PtyLtd', TODAY)
  assert.equal(asPty.ok, false)
  assert.match(asPty.error ?? '', /Other/)
})

test('the normalised number is what should be stored', () => {
  const r = checkRegistration('CK1998/012345/23', 'CloseCorporation', TODAY)
  assert.equal(r.ok, true)
  // The CK prefix is dropped so two records for the same entity match.
  assert.equal(r.normalised, '1998/012345/23')
})

test('only the types that actually have a certificate are treated as registered', () => {
  for (const type of ['PtyLtd', 'NPC', 'CloseCorporation', 'Cooperative'] as const) {
    assert.equal(isRegisteredType(type), true, type)
  }
  for (const type of ['SoleProprietor', 'Trust', 'Other'] as const) {
    assert.equal(isRegisteredType(type), false, type)
  }
  // A sole proprietor has no CIPC registration, so asking for a certificate
  // would be asking for a document that does not exist.
  assert.equal(REGISTERED_ENTITY_TYPES.includes('SoleProprietor'), false)
})
