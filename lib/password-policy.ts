/**
 * What counts as an acceptable password here.
 *
 * Kept separate and dependency-free so the rules can be tested, and so the
 * screen and the endpoint cannot disagree about them. A form that accepts a
 * password the server then refuses is a form people stop trusting.
 *
 * The rules are deliberately about length and obviousness rather than the
 * familiar demand for a symbol and a capital. Composition rules push people
 * towards `Password1!`, which satisfies every one of them and is among the
 * first things any attacker tries. Length is what actually costs an attacker
 * time, and a check against the passwords that get guessed first catches what
 * composition rules wave through.
 */

export const MIN_LENGTH = 12
export const MAX_LENGTH = 200

/**
 * Passwords common enough to be tried early in any attack.
 *
 * A short list, not a dictionary: a guard against the obvious, not a substitute
 * for the rate limiting and lockout that do the real work.
 */
const OBVIOUS = [
  'password',
  'admin',
  'administrator',
  'letmein',
  'welcome',
  'qwerty',
  'innovalanga',
  'saturated',
  'changeme',
  'secret',
  'iloveyou',
  'monkey',
  'dragon',
  'football',
  'test',

  // The roles this platform seeds accounts with. These are not weak by shape -
  // `Facilitator@1234` is sixteen characters and normalises to nothing on the
  // list above - they are weak because they are published. prisma/seed.ts is in
  // the repository, so every one of them is effectively a public password, and
  // the first thing anyone who finds this codebase would try.
  'facilitator',
  'mentor',
  'innovator',
  'funder',
  'superadmin',
]

/**
 * The weak word underneath the decoration: `P@ssword2026` becomes `password`.
 *
 * The substitutions matter more than the stripping. Simply removing every
 * non-letter turns `P@ssword2026` into `pssword`, which matches nothing on the
 * list above, and the password sails through. So the characters that stand in
 * for letters are translated back first. These are the ones people actually
 * reach for, not an exhaustive table.
 */
const SUBSTITUTIONS: Record<string, string> = {
  '@': 'a',
  '4': 'a',
  '0': 'o',
  '1': 'i',
  '!': 'i',
  '|': 'i',
  '3': 'e',
  '5': 's',
  $: 's',
  '7': 't',
  '9': 'g',
}

function root(password: string): string {
  return password
    .toLowerCase()
    .split('')
    .map((character) => SUBSTITUTIONS[character] ?? character)
    .join('')
    .replace(/[^a-z]/g, '')
}

export interface PasswordVerdict {
  acceptable: boolean
  /** Everything wrong, so fixing one thing does not reveal the next. */
  problems: string[]
}

export function checkPassword(
  password: string,
  context: { email?: string; name?: string } = {}
): PasswordVerdict {
  const problems: string[] = []

  if (/^\s*$/.test(password)) {
    return { acceptable: false, problems: ['Enter a password.'] }
  }

  if (password.length < MIN_LENGTH) {
    problems.push(
      `Use at least ${MIN_LENGTH} characters. Length is what makes a password hard to guess.`
    )
  }
  if (password.length > MAX_LENGTH) {
    problems.push(`Keep it under ${MAX_LENGTH} characters.`)
  }
  if (password.trim() !== password) {
    // Never trimmed silently: the password stored would not be the one typed,
    // and the next sign-in would fail for reasons nobody can see.
    problems.push('Remove the space at the start or end.')
  }

  const stem = root(password)
  if (stem.length > 2 && OBVIOUS.some((word) => stem === word || stem.startsWith(word))) {
    problems.push('That is one of the first passwords anybody would try. Choose something else.')
  }

  // A password containing the account it protects is barely a password.
  const local = context.email?.split('@')[0]?.toLowerCase()
  if (local && local.length > 2 && password.toLowerCase().includes(local)) {
    problems.push('Do not put your email address in your password.')
  }
  for (const part of (context.name ?? '').split(/\s+/)) {
    if (part.length > 2 && password.toLowerCase().includes(part.toLowerCase())) {
      problems.push('Do not put your name in your password.')
      break
    }
  }

  if (/^(.)\1+$/.test(password)) {
    problems.push('One repeated character is not a password.')
  }

  return { acceptable: problems.length === 0, problems }
}

/**
 * A rough sense of how much work the password represents, for the meter.
 *
 * Deliberately crude, and never used to accept or reject. A meter that gates
 * submission teaches people to game the meter; this only tells somebody whether
 * they have done better than the minimum.
 */
export function strength(password: string): 'weak' | 'fair' | 'strong' {
  if (password.length < MIN_LENGTH) return 'weak'
  const variety =
    (/[a-z]/.test(password) ? 1 : 0) +
    (/[A-Z]/.test(password) ? 1 : 0) +
    (/[0-9]/.test(password) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(password) ? 1 : 0)
  if (password.length >= 20 || (password.length >= 16 && variety >= 3)) return 'strong'
  if (variety >= 2) return 'fair'
  return 'weak'
}
