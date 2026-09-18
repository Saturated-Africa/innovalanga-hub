import { z } from 'zod'

/**
 * A drawn signature, as captured from a canvas.
 *
 * The funder expects to see a signature on the printed form, so the drawing is
 * kept. It is not what evidences the signature though: the typed name, the
 * deliberate act, the timestamp, the address it came from and the hash of what
 * was signed are. Those are recorded alongside and are what an audit relies on.
 *
 * Stored inline rather than through the document pipeline because a form is
 * signed before the person is a participant, and that pipeline binds every
 * object to a participant that does not exist yet.
 */

/** Roughly a 600x200 canvas at reasonable fidelity, with headroom. */
export const MAX_SIGNATURE_BYTES = 200 * 1024

const DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/

export const signatureImageSchema = z
  .string()
  .refine((v) => DATA_URL.test(v), {
    message: 'Signature must be a PNG data URL',
  })
  .refine(
    (v) => {
      // base64 expands by about a third; measure the decoded size.
      const base64 = v.slice(v.indexOf(',') + 1)
      const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
      return (base64.length * 3) / 4 - padding <= MAX_SIGNATURE_BYTES
    },
    { message: 'Signature image is too large' }
  )

/**
 * Where the signature came from.
 *
 * Best effort by nature: behind a proxy the address is only as trustworthy as
 * the proxy in front, and a user agent is self-reported. They are recorded
 * because an audit asks for the circumstances of signing, not because either
 * is proof on its own.
 */
export function signingContext(headers: Headers): { ip: string; ua: string } {
  const forwarded = headers.get('x-forwarded-for')
  const ip =
    forwarded?.split(',')[0]?.trim() ||
    headers.get('x-real-ip')?.trim() ||
    'unknown'

  return {
    ip,
    ua: (headers.get('user-agent') ?? 'unknown').slice(0, 400),
  }
}
