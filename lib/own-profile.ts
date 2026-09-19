import { validateSAIdNumber, validateSAPhone } from '@/lib/utils'

/**
 * What a participant may change about themselves.
 *
 * The platform had no answer to this at all: a participant could not correct a
 * misspelled surname or a changed phone number without asking a facilitator to
 * do it in the admin screens.
 *
 * The line drawn here is between description and classification. A participant
 * owns how they are described - their name, their number, what their business is
 * and what it does. They do not own how they are classified, because those
 * fields are what a funder's figures are grouped by:
 *
 *   cohort    decides which intake's results they appear in
 *   region    decides which province or district they are counted under
 *   email     is the login identity, and changing it needs a verification flow
 *             this does not have - so it stays with staff rather than being a
 *             way to take over an account
 *
 * The ID number is the interesting case. Participants are sometimes created
 * without one, and requiring staff for that makes onboarding slower for no
 * safety gain. But an ID a funder has already verified must not be quietly
 * replaced, so it may be set once and never overwritten. Changing one afterwards
 * is a conversation with a facilitator, which is the right amount of friction
 * for the field that identifies a person to the state.
 */

export interface OwnProfileInput {
  firstName?: unknown
  lastName?: unknown
  phone?: unknown
  businessName?: unknown
  businessSector?: unknown
  bio?: unknown
  idNumber?: unknown
}

export interface OwnProfileFields {
  firstName: string
  lastName: string
  phone: string | null
  businessName: string | null
  businessSector: string | null
  bio: string | null
  /** Present only when an ID is being set for the first time. */
  idNumber?: string
}

export type OwnProfileResult =
  | { ok: true; fields: OwnProfileFields }
  | { ok: false; errors: Record<string, string> }

const LIMITS = {
  firstName: 80,
  lastName: 80,
  phone: 30,
  businessName: 200,
  businessSector: 120,
  bio: 2000,
} as const

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Empty strings become null, so clearing a field is possible and means null. */
function optional(value: unknown): string | null {
  const t = text(value)
  return t === '' ? null : t
}

/**
 * Validate a participant's edit of their own profile.
 *
 * Returns every error rather than the first, because a form that reveals one
 * problem at a time is a form people submit four times.
 */
export function validateOwnProfile(
  input: OwnProfileInput,
  current: { hasIdNumber: boolean }
): OwnProfileResult {
  const errors: Record<string, string> = {}

  const firstName = text(input.firstName)
  const lastName = text(input.lastName)

  if (firstName === '') errors.firstName = 'Your first name cannot be empty.'
  else if (firstName.length > LIMITS.firstName) {
    errors.firstName = `Keep this under ${LIMITS.firstName} characters.`
  }

  if (lastName === '') errors.lastName = 'Your surname cannot be empty.'
  else if (lastName.length > LIMITS.lastName) {
    errors.lastName = `Keep this under ${LIMITS.lastName} characters.`
  }

  const phone = optional(input.phone)
  if (phone !== null) {
    if (phone.length > LIMITS.phone) errors.phone = 'That number is too long.'
    else if (!validateSAPhone(phone)) {
      errors.phone = 'Use a South African number, starting 0 or +27.'
    }
  }

  const businessName = optional(input.businessName)
  if (businessName && businessName.length > LIMITS.businessName) {
    errors.businessName = `Keep this under ${LIMITS.businessName} characters.`
  }

  const businessSector = optional(input.businessSector)
  if (businessSector && businessSector.length > LIMITS.businessSector) {
    errors.businessSector = `Keep this under ${LIMITS.businessSector} characters.`
  }

  const bio = optional(input.bio)
  if (bio && bio.length > LIMITS.bio) {
    errors.bio = `Keep this under ${LIMITS.bio} characters.`
  }

  // Set once, never replaced. An ID already on file is not editable here at all,
  // so sending one is refused rather than ignored - silently dropping it would
  // tell the participant their correction was saved.
  const idNumber = optional(input.idNumber)
  let idToSet: string | undefined
  if (idNumber !== null) {
    if (current.hasIdNumber) {
      errors.idNumber =
        'Your ID number is already on file. A facilitator has to change it, because a funder may have verified it.'
    } else if (!validateSAIdNumber(idNumber)) {
      errors.idNumber = 'That is not a valid 13 digit South African ID number.'
    } else {
      idToSet = idNumber
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  return {
    ok: true,
    fields: {
      firstName,
      lastName,
      phone,
      businessName,
      businessSector,
      bio,
      ...(idToSet ? { idNumber: idToSet } : {}),
    },
  }
}

/**
 * The fields a participant may never set about themselves.
 *
 * Exported so the route and its test can assert on one list rather than each
 * carrying its own idea of it. A field added to the profile later is not
 * self-editable until somebody puts it in validateOwnProfile deliberately.
 */
export const STAFF_ONLY_PROFILE_FIELDS = [
  'cohortId',
  'regionId',
  'userId',
  'id',
  'idNumberEncrypted',
] as const
