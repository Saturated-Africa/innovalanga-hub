/**
 * Pure redaction primitives.
 *
 * Dependency-free on purpose — no Prisma, no path aliases — so the rules that
 * decide whether a participant's name crosses a border can be tested in
 * isolation. `pseudonymise.ts` supplies the map from the database; this file
 * does the substitution.
 */

export interface PseudonymMap {
  /** token -> real value, for the client to reverse. */
  toReal: Record<string, string>
  /** real value -> token, applied server-side. */
  toToken: Record<string, string>
}

export const EMPTY_MAP: PseudonymMap = { toReal: {}, toToken: {} }

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Longest first, so "Zanele Mahlangu" is replaced before "Zanele". */
function longestFirst(keys: string[]): string[] {
  return [...keys].sort((a, b) => b.length - a.length)
}

/**
 * Add a real value to the map under a token.
 *
 * Values shorter than three characters are skipped: a two-letter surname would
 * match inside unrelated words often enough to mangle the text, and the
 * false-positive damage outweighs the marginal privacy gain.
 */
export function addMapping(map: PseudonymMap, real: string | null | undefined, token: string): void {
  const value = real?.trim()
  if (!value || value.length < 3) return
  if (map.toToken[value]) return
  map.toToken[value] = token
  if (!map.toReal[token]) map.toReal[token] = value
}

/** Replace every mapped real value in a string with its token. */
export function redactText(text: string, map: PseudonymMap): string {
  if (!text) return text
  let out = text
  for (const real of longestFirst(Object.keys(map.toToken))) {
    // Word boundaries so "Ann" does not corrupt "Announcement".
    out = out.replace(new RegExp(`\\b${escapeRegex(real)}\\b`, 'gi'), map.toToken[real])
  }
  return out
}

/**
 * Recursively redact any value.
 *
 * Walks the whole structure rather than a known field list, because names reach
 * the model through free-text bodies (session notes, assessment justifications,
 * mentorship logs) as often as through a `firstName` column. Object KEYS are
 * left alone — they are schema, not data.
 */
export function redactValue<T>(value: T, map: PseudonymMap): T {
  if (typeof value === 'string') return redactText(value, map) as unknown as T
  if (Array.isArray(value)) return value.map((v) => redactValue(v, map)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(v, map)
    }
    return out as T
  }
  return value
}

/**
 * Reverse the mapping.
 *
 * The browser does the user-facing reversal (it avoids a token being split
 * across two streamed chunks); this is used in tests and for verifying that a
 * redacted payload really does round-trip.
 */
export function rehydrateText(text: string, map: PseudonymMap): string {
  if (!text) return text
  let out = text
  for (const token of longestFirst(Object.keys(map.toReal))) {
    out = out.split(token).join(map.toReal[token])
  }
  return out
}

/** True when no mapped real value survives anywhere in the payload. */
export function isFullyRedacted(payload: unknown, map: PseudonymMap): boolean {
  const serialised = JSON.stringify(payload) ?? ''
  return !Object.keys(map.toToken).some((real) =>
    new RegExp(`\\b${escapeRegex(real)}\\b`, 'i').test(serialised)
  )
}
