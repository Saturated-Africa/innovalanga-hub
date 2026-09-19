import { randomBytes } from 'crypto'

/**
 * A readable one-time password for an account somebody else created.
 *
 * Shared by the two paths that create a participant account - an administrator
 * adding one directly, and accepting a beneficiary form - because two generators
 * would drift, and the one that drifted would be the one nobody tested.
 *
 * No ambiguous characters and no dictionary words: this gets read down a phone or
 * copied off a screen, so "l" against "1" and "O" against "0" are the difference
 * between working and a support call. Grouped in fours for the same reason.
 *
 * Random bytes rather than Math.random, because it is a credential until the
 * person changes it.
 */
export function generateTempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = randomBytes(16)
  let out = ''
  for (let i = 0; i < 16; i++) out += alphabet[bytes[i] % alphabet.length]
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12)}`
}
