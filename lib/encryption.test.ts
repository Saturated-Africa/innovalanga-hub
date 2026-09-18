import { test } from 'node:test'
import assert from 'node:assert/strict'

// Set before the first call, not before the import: the module reads the key
// inside each operation rather than at load, so a static import is enough and
// avoids top-level await, which cannot be emitted under this project's module
// format.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'a'.repeat(64)

import { encrypt, decrypt, maskIdNumber } from './encryption.ts'

/**
 * The behaviour these lock down is what the previous implementation got wrong:
 * it padded a short key to length and truncated a correct one, both silently.
 */

test('a value round-trips', () => {
  const id = '9001015800083'
  assert.equal(decrypt(encrypt(id)), id)
})

test('the same input encrypts differently every time', () => {
  const a = encrypt('9001015800083')
  const b = encrypt('9001015800083')
  assert.notEqual(a, b, 'a fresh salt and IV must be used per value')
  assert.equal(decrypt(a), decrypt(b))
})

test('ciphertext carries a version prefix so keys can be rotated', () => {
  assert.match(encrypt('test'), /^v1:/)
})

test('a tampered value is rejected rather than returned', () => {
  const value = encrypt('9001015800083')
  const body = Buffer.from(value.slice(3), 'base64')
  body[body.length - 1] ^= 0xff
  const tampered = 'v1:' + body.toString('base64')

  assert.throws(() => decrypt(tampered))
})

test('an unknown version is refused', () => {
  assert.throws(() => decrypt('v2:abcdef'), /Unsupported ciphertext version/)
})

test('a value with no version prefix is refused', () => {
  assert.throws(() => decrypt('abcdef'), /no version prefix/)
})

test('a short key is refused instead of being padded', async () => {
  const original = process.env.ENCRYPTION_KEY
  process.env.ENCRYPTION_KEY = 'short'
  try {
    assert.throws(() => encrypt('test'), /at least 32 characters/)
  } finally {
    process.env.ENCRYPTION_KEY = original
  }
})

test('a missing key is refused', () => {
  const original = process.env.ENCRYPTION_KEY
  delete process.env.ENCRYPTION_KEY
  try {
    assert.throws(() => encrypt('test'), /not set/)
  } finally {
    process.env.ENCRYPTION_KEY = original
  }
})

test('the full key is used, not the first 32 characters', () => {
  const original = process.env.ENCRYPTION_KEY

  // Two keys identical in their first 32 characters. The old implementation
  // sliced to 32 and so treated these as the same key.
  const keyA = 'f'.repeat(32) + '1'.repeat(32)
  const keyB = 'f'.repeat(32) + '2'.repeat(32)

  try {
    process.env.ENCRYPTION_KEY = keyA
    const ciphertext = encrypt('9001015800083')

    process.env.ENCRYPTION_KEY = keyB
    assert.throws(
      () => decrypt(ciphertext),
      'a different key must not decrypt this value'
    )
  } finally {
    process.env.ENCRYPTION_KEY = original
  }
})

test('masking reveals only the last four digits', () => {
  assert.equal(maskIdNumber('9001015800083'), '•••••••••0083')
  assert.equal(maskIdNumber('12'), '••')
})
