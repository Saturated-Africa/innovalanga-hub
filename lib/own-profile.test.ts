import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateOwnProfile,
  STAFF_ONLY_PROFILE_FIELDS,
  type OwnProfileInput,
} from './own-profile'
import { validateSAIdNumber } from './utils'

/**
 * The rule these tests exist for is the ID number one: set once, never
 * replaced. Everything else here is ordinary field validation, but that rule
 * decides whether a participant can quietly change the number a funder verified
 * them against.
 */

const base: OwnProfileInput = {
  firstName: 'Zanele',
  lastName: 'Mthembu',
  phone: '0821234567',
  businessName: 'Mthembu Agri',
  businessSector: 'Agriculture',
  bio: 'Smallholder irrigation.',
}

const NO_ID = { hasIdNumber: false }
const HAS_ID = { hasIdNumber: true }

/** A 13 digit number that passes Luhn, so the accepting path is really tested. */
const VALID_ID = (() => {
  const stem = '900101500108'
  for (let check = 0; check <= 9; check++) {
    const candidate = `${stem}${check}`
    if (validateSAIdNumber(candidate)) return candidate
  }
  throw new Error('no valid check digit found for the test fixture')
})()

test('the fixture ID is actually valid, or the accepting tests prove nothing', () => {
  assert.equal(validateSAIdNumber(VALID_ID), true)
  assert.equal(VALID_ID.length, 13)
})

test('accepts an ordinary edit', () => {
  const result = validateOwnProfile(base, NO_ID)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.fields.firstName, 'Zanele')
  assert.equal(result.fields.phone, '0821234567')
  assert.equal(result.fields.idNumber, undefined)
})

test('trims whitespace rather than storing it', () => {
  const result = validateOwnProfile({ ...base, firstName: '  Zanele  ' }, NO_ID)
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.fields.firstName, 'Zanele')
})

test('an empty optional field clears it, and means null rather than an empty string', () => {
  const result = validateOwnProfile(
    { ...base, businessName: '', bio: '   ' },
    NO_ID
  )
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.fields.businessName, null)
  assert.equal(result.fields.bio, null)
})

test('a name cannot be emptied', () => {
  const result = validateOwnProfile({ ...base, firstName: '', lastName: '  ' }, NO_ID)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.ok(result.errors.firstName)
  assert.ok(result.errors.lastName)
})

test('reports every error at once, not the first', () => {
  const result = validateOwnProfile(
    { firstName: '', lastName: '', phone: '12345', bio: 'x'.repeat(2001) },
    NO_ID
  )
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(Object.keys(result.errors).length, 4)
})

test('refuses a phone number that is not South African', () => {
  for (const phone of ['12345', '+441234567890', '0123456789']) {
    const result = validateOwnProfile({ ...base, phone }, NO_ID)
    assert.equal(result.ok, false, phone)
  }
})

test('accepts both local and international South African formats', () => {
  for (const phone of ['0821234567', '+27821234567', '082 123 4567']) {
    const result = validateOwnProfile({ ...base, phone }, NO_ID)
    assert.equal(result.ok, true, phone)
  }
})

test('an ID number can be set when there is none on file', () => {
  const result = validateOwnProfile({ ...base, idNumber: VALID_ID }, NO_ID)
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.fields.idNumber, VALID_ID)
})

test('an invalid ID number is refused rather than stored', () => {
  for (const id of ['123', '1234567890123', 'abcdefghijklm']) {
    const result = validateOwnProfile({ ...base, idNumber: id }, NO_ID)
    assert.equal(result.ok, false, id)
  }
})

test('an ID already on file cannot be replaced, and says why', () => {
  const result = validateOwnProfile({ ...base, idNumber: VALID_ID }, HAS_ID)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.errors.idNumber, /facilitator/i)
})

test('sending no ID is fine whether or not one is on file', () => {
  assert.equal(validateOwnProfile(base, HAS_ID).ok, true)
  assert.equal(validateOwnProfile(base, NO_ID).ok, true)
  assert.equal(validateOwnProfile({ ...base, idNumber: '' }, HAS_ID).ok, true)
})

test('the accepted fields never include anything a participant may not set', () => {
  // The real protection is that the route writes only these fields. This asserts
  // the two lists cannot quietly overlap.
  const result = validateOwnProfile(
    { ...base, ...({ cohortId: 'other', regionId: 'other' } as OwnProfileInput) },
    NO_ID
  )
  assert.equal(result.ok, true)
  if (!result.ok) return

  for (const field of STAFF_ONLY_PROFILE_FIELDS) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(result.fields, field),
      false,
      field
    )
  }
})

test('classification fields are on the staff-only list', () => {
  // Named explicitly: these decide which intake and which province a
  // participant's results are counted under, so a funder's totals move if a
  // participant can change them.
  for (const field of ['cohortId', 'regionId']) {
    assert.equal(
      (STAFF_ONLY_PROFILE_FIELDS as readonly string[]).includes(field),
      true,
      field
    )
  }
})
