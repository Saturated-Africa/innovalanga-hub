import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkPassword, strength, MIN_LENGTH } from './password-policy'

test('a long, unremarkable password is accepted', () => {
  const v = checkPassword('correct horse battery staple')
  assert.equal(v.acceptable, true, v.problems.join(' '))
})

test('too short is refused, and the message says why length matters', () => {
  const v = checkPassword('Short1!')
  assert.equal(v.acceptable, false)
  assert.match(v.problems.join(' '), new RegExp(`${MIN_LENGTH} characters`))
})

test('the seeded passwords this platform shipped with are refused', () => {
  // The whole reason this screen exists: every account is on one of these and
  // they are committed to the repository.
  for (const seeded of ['Admin@1234', 'Facilitator@1234', 'Mentor@1234', 'Innovator@1234']) {
    const v = checkPassword(seeded)
    assert.equal(v.acceptable, false, `${seeded} should be refused`)
  }
})

test('decoration on a weak root does not rescue it', () => {
  // Admin@1234 and admin are the same idea. So are password and P@ssword99.
  for (const p of ['Admin@1234!!', 'P@ssword2026', 'LetMeIn123456', 'Qwerty!2026']) {
    assert.equal(checkPassword(p).acceptable, false, `${p} should be refused`)
  }
})

test('the organisation name is not a password', () => {
  assert.equal(checkPassword('Innovalanga2026').acceptable, false)
  assert.equal(checkPassword('SaturatedAfrica1').acceptable, false)
})

test('a password containing the account it protects is refused', () => {
  const v = checkPassword('nkululeko-long-enough', { email: 'nkululeko@saturated.co.za' })
  assert.equal(v.acceptable, false)
  assert.match(v.problems.join(' '), /email address/)
})

test('a password containing the person’s name is refused', () => {
  const v = checkPassword('ThulisileIsHere2026', { name: 'Thulisile Mahlangu' })
  assert.equal(v.acceptable, false)
  assert.match(v.problems.join(' '), /your name/)
})

test('a short name fragment does not trigger a false refusal', () => {
  // "Jo" is two characters; refusing every password containing "jo" would
  // reject "enjoyable-long-passphrase" for no reason.
  const v = checkPassword('enjoyable long passphrase', { name: 'Jo Smith' })
  assert.equal(v.acceptable, true, v.problems.join(' '))
})

test('surrounding whitespace is refused rather than silently trimmed', () => {
  // Trimming it server-side means the password stored is not the one typed,
  // and the next login fails for reasons nobody can see.
  const v = checkPassword('  a decent long password  ')
  assert.equal(v.acceptable, false)
  assert.match(v.problems.join(' '), /space at the start or end/)
})

test('one repeated character is not a password', () => {
  assert.equal(checkPassword('aaaaaaaaaaaaaaaa').acceptable, false)
})

test('every problem is reported, not just the first', () => {
  const v = checkPassword('admin', { email: 'admin@example.com' })
  assert.ok(v.problems.length >= 2, `expected several problems, got ${v.problems.length}`)
})

test('composition is not demanded, because it produces Password1!', () => {
  // A long passphrase with no digits or symbols is fine, and is stronger than
  // the eight-character thing that satisfies a composition rule.
  const v = checkPassword('the wind across the highveld')
  assert.equal(v.acceptable, true, v.problems.join(' '))
})

test('the meter describes, it does not gate', () => {
  assert.equal(strength('short'), 'weak')
  assert.equal(strength('twelvechars1'), 'fair')
  assert.equal(strength('a rather long passphrase indeed'), 'strong')
})
