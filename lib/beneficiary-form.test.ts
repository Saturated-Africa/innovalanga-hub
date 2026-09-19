import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  beneficiaryDraftSchema,
  missingBeforeSigning,
  hashAnswers,
  deriveFromIdNumber,
  resolveDateOfBirth,
  ageAt,
  PROVINCES,
  RACES,
  GENDERS,
  TITLES,
} from './beneficiary-form.ts'
import { validateSAIdNumber } from './utils'

/** A draft that is complete enough to sign. */
function completeDraft(over: Record<string, unknown> = {}) {
  return {
    fullName: 'Thandiwe Mokoena',
    email: 'thandiwe@example.org',
    gender: 'Female',
    race: 'Black',
    title: 'Ms',
    province: 'Gauteng',
    cellphone: '0821234567',
    physicalAddress: '12 Example Road, Springs',
    hasDisability: false,
    ...over,
  }
}

test('the option sets match the paper form exactly', () => {
  assert.deepEqual([...GENDERS], ['Male', 'Female'])
  assert.deepEqual([...RACES], ['Black', 'White', 'Other'])
  assert.deepEqual([...TITLES], ['Mr', 'Ms', 'Mrs', 'Other'])
  assert.equal(PROVINCES.length, 9)
})

test('a valid draft parses', () => {
  const parsed = beneficiaryDraftSchema.safeParse(completeDraft())
  assert.equal(parsed.success, true)
})

test('an ID number must be thirteen digits', () => {
  assert.equal(
    beneficiaryDraftSchema.safeParse(completeDraft({ idNumber: '123' })).success,
    false
  )
  assert.equal(
    beneficiaryDraftSchema.safeParse(completeDraft({ idNumber: '9001015800083' })).success,
    true
  )
})

test('a complete draft is ready to sign', () => {
  assert.deepEqual(missingBeforeSigning(completeDraft()), [])
})

test('a blank demographic blocks signing', () => {
  for (const field of ['gender', 'race', 'title', 'province']) {
    const draft = completeDraft({ [field]: undefined })
    assert.ok(missingBeforeSigning(draft).includes(field), field)
  }
})

test('an unanswered disability question is not treated as no', () => {
  const draft = completeDraft({ hasDisability: undefined })
  assert.ok(missingBeforeSigning(draft).includes('hasDisability'))

  // Explicitly false is an answer and must pass.
  assert.deepEqual(missingBeforeSigning(completeDraft({ hasDisability: false })), [])
})

test('choosing Other requires saying what the other is', () => {
  assert.ok(missingBeforeSigning(completeDraft({ race: 'Other' })).includes('raceOther'))
  assert.deepEqual(
    missingBeforeSigning(completeDraft({ race: 'Other', raceOther: 'Coloured' })),
    []
  )
  assert.ok(missingBeforeSigning(completeDraft({ title: 'Other' })).includes('titleOther'))
})

test('the signature hash is stable across key order', () => {
  const a = hashAnswers({ fullName: 'A', email: 'a@b.c', gender: 'Male' })
  const b = hashAnswers({ gender: 'Male', email: 'a@b.c', fullName: 'A' })
  assert.equal(a, b, 'key order must not change the fingerprint')
})

test('altering any answer changes the hash', () => {
  const before = hashAnswers(completeDraft())
  const after = hashAnswers(completeDraft({ cellphone: '0829999999' }))
  assert.notEqual(before, after)
})

test('a blank and a missing answer hash the same', () => {
  // Otherwise an untouched optional field would invalidate a signature.
  assert.equal(
    hashAnswers({ fullName: 'A', projectTitle: '' }),
    hashAnswers({ fullName: 'A' })
  )
})

test('date of birth and gender come out of the ID number', () => {
  // 1990-01-01, sequence 5800 -> male
  const male = deriveFromIdNumber('9001015800083')
  assert.ok(male)
  assert.equal(male.gender, 'Male')
  assert.equal(male.dateOfBirth.getUTCFullYear(), 1990)
  assert.equal(male.dateOfBirth.getUTCMonth(), 0)
  assert.equal(male.dateOfBirth.getUTCDate(), 1)

  // sequence below 5000 -> female
  const female = deriveFromIdNumber('9001010800080')
  assert.ok(female)
  assert.equal(female.gender, 'Female')
})

test('a malformed ID number derives nothing rather than guessing', () => {
  assert.equal(deriveFromIdNumber('12345'), null)
  assert.equal(deriveFromIdNumber('9013015800083'), null, 'month 13')
  assert.equal(deriveFromIdNumber('900101580008X'), null)
})

test('age is computed on whole years, not rounded', () => {
  const dob = new Date(Date.UTC(1990, 5, 15))
  assert.equal(ageAt(dob, new Date(Date.UTC(2025, 5, 14))), 34, 'day before birthday')
  assert.equal(ageAt(dob, new Date(Date.UTC(2025, 5, 15))), 35, 'on birthday')
})

/* ------------------------------------------------------------------ *
 * resolveDateOfBirth
 *
 * The mismatch rule is the reason this function exists. Both inputs are meant
 * to be the same person's birth date, so a disagreement means one is mistyped -
 * and one of them is an identity number, where a typo matters well beyond a
 * youth count.
 * ------------------------------------------------------------------ */

/** 1 January 2000, with a valid Luhn check digit. */
const DOB_ID = (() => {
  for (let check = 0; check <= 9; check++) {
    const candidate = `000101500108${check}`
    if (validateSAIdNumber(candidate)) return candidate
  }
  throw new Error('no valid check digit for the fixture')
})()

const TODAY = new Date('2026-09-19T00:00:00.000Z')

test('takes the typed date when there is no ID number', () => {
  const r = resolveDateOfBirth({ typed: '1995-04-17', today: TODAY })
  assert.equal(r.ok, true)
  assert.equal(r.derived, false)
  assert.equal(r.dateOfBirth?.toISOString().slice(0, 10), '1995-04-17')
})

test('derives from the ID number when nothing was typed', () => {
  const r = resolveDateOfBirth({ idNumber: DOB_ID, today: TODAY })
  assert.equal(r.ok, true)
  assert.equal(r.derived, true)
  assert.equal(r.dateOfBirth?.toISOString().slice(0, 10), '2000-01-01')
})

test('accepts both when they agree', () => {
  const r = resolveDateOfBirth({ typed: '2000-01-01', idNumber: DOB_ID, today: TODAY })
  assert.equal(r.ok, true)
  assert.equal(r.dateOfBirth?.toISOString().slice(0, 10), '2000-01-01')
})

test('refuses when they disagree, naming both dates', () => {
  const r = resolveDateOfBirth({ typed: '1995-04-17', idNumber: DOB_ID, today: TODAY })
  assert.equal(r.ok, false)
  assert.match(r.error ?? '', /2000-01-01/)
  assert.match(r.error ?? '', /1995-04-17/)
  assert.match(r.error ?? '', /mistyped/i)
})

test('neither given is not an error - an unknown age is reported as unknown', () => {
  const r = resolveDateOfBirth({ today: TODAY })
  assert.equal(r.ok, true)
  assert.equal(r.dateOfBirth, null)
})

test('refuses a future date of birth', () => {
  const r = resolveDateOfBirth({ typed: '2027-01-01', today: TODAY })
  assert.equal(r.ok, false)
  assert.match(r.error ?? '', /future/i)
})

test('accepts a date of birth of today, because newborns exist', () => {
  const r = resolveDateOfBirth({ typed: '2026-09-19', today: TODAY })
  assert.equal(r.ok, true)
})

test('refuses a year that looks mistyped without arguing about anybody real', () => {
  // The oldest verified person reached 122; the bound is 130.
  assert.equal(resolveDateOfBirth({ typed: '1910-01-01', today: TODAY }).ok, true)
  assert.equal(resolveDateOfBirth({ typed: '1850-01-01', today: TODAY }).ok, false)
})

test('an unparseable ID contributes nothing rather than failing the form', () => {
  // The ID is validated separately and reported separately. A malformed one here
  // must not turn into a confusing date error.
  const r = resolveDateOfBirth({ typed: '1995-04-17', idNumber: 'not-an-id', today: TODAY })
  assert.equal(r.ok, true)
  assert.equal(r.dateOfBirth?.toISOString().slice(0, 10), '1995-04-17')
})
