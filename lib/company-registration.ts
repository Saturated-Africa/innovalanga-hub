/**
 * South African company registration numbers.
 *
 * A CIPC registration number is not an opaque string: it is
 * `YYYY/NNNNNN/SS`, where the year is when the entity was registered and the
 * two-digit suffix says what kind of entity it is. That makes it checkable, and
 * worth checking - a facilitator typing one off a certificate is the moment a
 * digit gets dropped, and the number ends up on a grant agreement and a funder's
 * report.
 *
 * The suffixes are set by the Companies Act 71 of 2008 and the legislation it
 * replaced. The two this programme cares about most are 07 and 08 - private
 * companies and non-profit companies - but the others are recognised so that
 * somebody registering a co-operative is told their number looks like a
 * co-operative rather than being told it is wrong.
 */

export type EntityKind =
  | 'PtyLtd'
  | 'NPC'
  | 'CloseCorporation'
  | 'SoleProprietor'
  | 'Trust'
  | 'Cooperative'
  | 'Other'

/**
 * What each suffix means, and which of our entity types it corresponds to.
 *
 * `entityType: null` means the suffix is a real registration type that this
 * platform has no enum value for. It is recognised rather than rejected: the
 * number is valid, and telling somebody their public company is invalid because
 * a dropdown is short would be our problem presented as theirs.
 */
const SUFFIXES: Record<string, { label: string; entityType: EntityKind | null }> = {
  '06': { label: 'public company (Ltd)', entityType: null },
  '07': { label: 'private company ((Pty) Ltd)', entityType: 'PtyLtd' },
  '08': { label: 'non-profit company (NPC)', entityType: 'NPC' },
  '09': { label: 'non-profit company (NPC)', entityType: 'NPC' },
  '10': { label: 'external company', entityType: null },
  '21': { label: 'personal liability company (Inc)', entityType: null },
  '22': { label: 'close corporation', entityType: 'CloseCorporation' },
  '23': { label: 'close corporation', entityType: 'CloseCorporation' },
  '24': { label: 'co-operative', entityType: 'Cooperative' },
  '25': { label: 'co-operative', entityType: 'Cooperative' },
  '30': { label: 'state-owned company (SOC Ltd)', entityType: null },
}

/** The entity types that have a CIPC registration number at all. */
export const REGISTERED_ENTITY_TYPES: EntityKind[] = [
  'PtyLtd',
  'NPC',
  'CloseCorporation',
  'Cooperative',
]

export interface ParsedRegistration {
  ok: boolean
  /** Normalised as YYYY/NNNNNN/SS. */
  normalised?: string
  year?: number
  suffix?: string
  /** What the suffix says this entity is. */
  label?: string
  /** Our enum value for that suffix, when one exists. */
  entityType?: EntityKind | null
  error?: string
}

const PATTERN = /^(\d{4})\/(\d{6,7})\/(\d{2})$/

/**
 * Parse a registration number, or say what is wrong with it.
 *
 * Spaces and a `CK` prefix are tolerated on the way in. Close corporations
 * registered before 2008 were written `CK1998/012345/23` on their certificates,
 * and somebody copying one faithfully should not be told it is malformed.
 */
export function parseRegistrationNumber(
  input: string,
  today: Date = new Date()
): ParsedRegistration {
  const cleaned = input.trim().replace(/\s+/g, '').replace(/^CK/i, '')

  if (cleaned === '') {
    return { ok: false, error: 'Enter the registration number from the certificate.' }
  }

  const match = PATTERN.exec(cleaned)
  if (!match) {
    return {
      ok: false,
      error:
        'A CIPC registration number looks like 2016/123456/07 - year, number, then two digits for the type.',
    }
  }

  const [, yearText, sequence, suffix] = match
  const year = Number(yearText)
  const thisYear = today.getUTCFullYear()

  // The Companies Act of 1973 is the oldest anything still trading would carry.
  if (year < 1900 || year > thisYear) {
    return {
      ok: false,
      error: `The year ${year} cannot be right - it should be the year the entity was registered.`,
    }
  }

  const known = SUFFIXES[suffix]
  if (!known) {
    return {
      ok: false,
      error: `${suffix} is not a registration type CIPC issues. Check the last two digits.`,
    }
  }

  return {
    ok: true,
    normalised: `${yearText}/${sequence}/${suffix}`,
    year,
    suffix,
    label: known.label,
    entityType: known.entityType,
  }
}

export interface RegistrationCheck {
  ok: boolean
  normalised?: string
  error?: string
  /** True when the number parsed but describes a different kind of entity. */
  mismatch?: boolean
}

/**
 * Check a registration number against the entity type somebody selected.
 *
 * A mismatch is refused rather than quietly corrected. Either the number is
 * mistyped or the wrong type was picked, and both are worth a human looking at:
 * the entity type decides how the organisation is treated in a funder's report,
 * and the number is what a funder uses to look the entity up.
 *
 * When the suffix is a valid type this platform has no enum for - a public
 * company, say - the number is accepted as long as the selection is `Other`,
 * which is the honest answer rather than forcing a wrong choice.
 */
export function checkRegistration(
  input: string,
  declaredType: EntityKind,
  today: Date = new Date()
): RegistrationCheck {
  const parsed = parseRegistrationNumber(input, today)
  if (!parsed.ok) return { ok: false, error: parsed.error }

  const implied = parsed.entityType

  if (implied === null) {
    if (declaredType === 'Other') return { ok: true, normalised: parsed.normalised }
    return {
      ok: false,
      mismatch: true,
      error:
        `That number is a ${parsed.label}, which is not one of the types listed. ` +
        `Choose "Other" for it.`,
    }
  }

  if (implied !== declaredType) {
    return {
      ok: false,
      mismatch: true,
      error:
        `That number ends /${parsed.suffix}, which is a ${parsed.label}, ` +
        `but the entity type says ${labelFor(declaredType)}. One of the two is wrong.`,
    }
  }

  return { ok: true, normalised: parsed.normalised }
}

const TYPE_LABELS: Record<EntityKind, string> = {
  PtyLtd: 'private company ((Pty) Ltd)',
  NPC: 'non-profit company (NPC)',
  CloseCorporation: 'close corporation',
  SoleProprietor: 'sole proprietor',
  Trust: 'trust',
  Cooperative: 'co-operative',
  Other: 'other',
}

export function labelFor(type: EntityKind): string {
  return TYPE_LABELS[type] ?? type
}

/** Whether this kind of entity has a CIPC certificate to upload at all. */
export function isRegisteredType(type: EntityKind): boolean {
  return REGISTERED_ENTITY_TYPES.includes(type)
}
