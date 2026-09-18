import crypto from 'crypto'

/**
 * Field-level encryption for personal data held under POPIA.
 *
 * The previous key handling was `Buffer.from(key.padEnd(32, '0').slice(0, 32))`,
 * which had three separate problems:
 *
 *   - No key derivation. The environment variable's raw bytes were the AES key,
 *     so a human-chosen passphrase became a low-entropy key directly.
 *   - It silently accepted anything. A one-character `ENCRYPTION_KEY` was padded
 *     with zeros to 32 bytes and used without complaint, so a misconfigured
 *     deployment encrypted real ID numbers under an effectively known key and
 *     reported no error.
 *   - It silently truncated. `.env.example` documents a 64-character hex value,
 *     which is 32 bytes of entropy; `.slice(0, 32)` cut that hex *string* to 32
 *     characters, so exactly half the documented key material was discarded and
 *     the operator had no way to notice.
 *
 * Two things make this safe to change now. `decrypt()` is not called anywhere in
 * the application yet, and exactly one column is encrypted, so there is no
 * ciphertext in service that a new scheme has to stay compatible with. Once real
 * participant records exist this becomes a re-encryption migration instead.
 *
 * Format: `v1:` + base64(salt || iv || tag || ciphertext). The version prefix is
 * what makes a future key rotation possible at all - the old scheme had no way
 * to tell which key produced a given value.
 */

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // 96 bits, the size GCM is specified for
const TAG_LENGTH = 16
const SALT_LENGTH = 16
const KEY_LENGTH = 32
const VERSION = 'v1'

/** Below this, a passphrase is not worth deriving a key from. */
const MIN_KEY_LENGTH = 32

/** scrypt parameters. N=2^15 is a deliberate cost, paid once per operation. */
const SCRYPT_N = 32768
const SCRYPT_r = 8
const SCRYPT_p = 1
const SCRYPT_MAXMEM = 64 * 1024 * 1024

function secret(): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) {
    throw new Error('ENCRYPTION_KEY is not set')
  }
  if (key.length < MIN_KEY_LENGTH) {
    // Refuse rather than pad. A weak key that appears to work is the failure
    // mode this replaces.
    throw new Error(
      `ENCRYPTION_KEY must be at least ${MIN_KEY_LENGTH} characters. ` +
        'Generate one with: openssl rand -hex 32'
    )
  }
  return key
}

/**
 * Derive the AES key from the configured secret and a per-value salt.
 *
 * A fresh salt per value means two records holding the same ID number do not
 * share a key, and it removes any benefit from precomputation against the
 * secret.
 */
function deriveKey(salt: Buffer): Buffer {
  return crypto.scryptSync(secret(), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
    maxmem: SCRYPT_MAXMEM,
  })
}

export function encrypt(text: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH)
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(salt), iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return `${VERSION}:${Buffer.concat([salt, iv, tag, encrypted]).toString('base64')}`
}

export function decrypt(value: string): string {
  const separator = value.indexOf(':')
  if (separator === -1) {
    throw new Error('Ciphertext has no version prefix')
  }

  const version = value.slice(0, separator)
  if (version !== VERSION) {
    throw new Error(`Unsupported ciphertext version: ${version}`)
  }

  const buf = Buffer.from(value.slice(separator + 1), 'base64')
  const salt = buf.subarray(0, SALT_LENGTH)
  const iv = buf.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
  const tag = buf.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH)
  const encrypted = buf.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH)

  const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(salt), iv)
  decipher.setAuthTag(tag)

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

/**
 * Last four digits, for confirming a record without revealing it.
 *
 * Preferred over decrypting for display anywhere in the UI.
 */
export function maskIdNumber(idNumber: string): string {
  if (idNumber.length < 4) return '•'.repeat(idNumber.length)
  return '•'.repeat(idNumber.length - 4) + idNumber.slice(-4)
}
