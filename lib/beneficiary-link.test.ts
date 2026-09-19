import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canLink,
  splitFullName,
  profileFromRecord,
  type LinkableRecord,
  type ExistingAccount,
} from './beneficiary-link'

/**
 * The name split is the part that will be wrong in production if it is wrong
 * here, because it decides how a person's surname appears on every funder
 * register, export and search for the rest of the programme.
 */

const record: LinkableRecord = {
  innovatorId: null,
  cohortId: 'cohort-1',
  fullName: 'Zanele Mthembu',
}

const noAccount: ExistingAccount = { userId: null, hasInnovatorProfile: false }

test('links an accepted record with a cohort and a name', () => {
  assert.equal(canLink(record, noAccount).allowed, true)
})

test('refuses to link twice', () => {
  const v = canLink({ ...record, innovatorId: 'inn-1' }, noAccount)
  assert.equal(v.allowed, false)
  assert.equal(v.block, 'already-linked')
})

test('refuses without a cohort, and says why it matters', () => {
  const v = canLink({ ...record, cohortId: null }, noAccount)
  assert.equal(v.allowed, false)
  assert.equal(v.block, 'no-cohort')
  assert.match(v.reason ?? '', /assessed|cohort report/i)
})

test('refuses when the email already belongs to a participant', () => {
  // Two records for one person is the likely cause, and silently creating a
  // second profile would split their assessments across both.
  const v = canLink(record, { userId: 'user-1', hasInnovatorProfile: true })
  assert.equal(v.allowed, false)
  assert.equal(v.block, 'email-belongs-to-a-participant')
})

test('an account with no profile yet is fine to attach to', () => {
  // A beneficiary who filled the form in themselves already has a login. That
  // account becomes the participant rather than a second one being made.
  const v = canLink(record, { userId: 'user-1', hasInnovatorProfile: false })
  assert.equal(v.allowed, true)
})

test('refuses a record with no usable name', () => {
  for (const fullName of ['', '   ']) {
    const v = canLink({ ...record, fullName }, noAccount)
    assert.equal(v.allowed, false, JSON.stringify(fullName))
    assert.equal(v.block, 'no-name')
  }
})

test('splits a two-part name the obvious way', () => {
  assert.deepEqual(splitFullName('Zanele Mthembu'), {
    firstName: 'Zanele',
    lastName: 'Mthembu',
  })
})

test('keeps a multi-word surname intact', () => {
  // The surname is what a funder register is sorted and searched by, so it is
  // the half that must survive. "Van" as a surname would be wrong on every page.
  assert.deepEqual(splitFullName('Johan van der Merwe'), {
    firstName: 'Johan',
    lastName: 'van der Merwe',
  })
  assert.deepEqual(splitFullName('Nomsa Ka Mthembu'), {
    firstName: 'Nomsa',
    lastName: 'Ka Mthembu',
  })
})

test('a single name becomes a first name rather than being rejected', () => {
  // Mononyms exist. Refusing one would strand a form somebody has already signed.
  assert.deepEqual(splitFullName('Sizwe'), { firstName: 'Sizwe', lastName: '' })
})

test('collapses the extra whitespace people type', () => {
  assert.deepEqual(splitFullName('  Zanele   Mthembu  '), {
    firstName: 'Zanele',
    lastName: 'Mthembu',
  })
})

test('carries the ID number across as ciphertext, never decrypted', () => {
  const fields = profileFromRecord({
    fullName: 'Zanele Mthembu',
    cellphone: '0821234567',
    projectTitle: 'Mthembu Agri',
    sector: 'Agriculture',
    conceptDescription: 'Drip irrigation for smallholders.',
    idNumberEncrypted: 'v1:abc123:def456',
  })
  assert.equal(fields.idNumberEncrypted, 'v1:abc123:def456')
  assert.equal(fields.firstName, 'Zanele')
  assert.equal(fields.businessName, 'Mthembu Agri')
  assert.equal(fields.businessSector, 'Agriculture')
})

test('empty optional fields become null, not empty strings', () => {
  const fields = profileFromRecord({
    fullName: 'Sizwe Dlamini',
    cellphone: '  ',
    projectTitle: '',
    sector: null,
    conceptDescription: null,
    idNumberEncrypted: null,
  })
  assert.equal(fields.phone, null)
  assert.equal(fields.businessName, null)
  assert.equal(fields.businessSector, null)
  assert.equal(fields.bio, null)
})

test('the project becomes the business, because that is what is assessed', () => {
  // TRL, BRL and IRL are scored against the venture the form describes. Dropping
  // it would mean a facilitator retyping it from a form they just read.
  const fields = profileFromRecord({
    fullName: 'A B',
    cellphone: null,
    projectTitle: 'Solar Dryer Co-op',
    sector: 'Manufacturing',
    conceptDescription: 'Drying fruit without diesel.',
    idNumberEncrypted: null,
  })
  assert.equal(fields.businessName, 'Solar Dryer Co-op')
  assert.equal(fields.bio, 'Drying fruit without diesel.')
})
