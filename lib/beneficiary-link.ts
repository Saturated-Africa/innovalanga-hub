/**
 * Turning an accepted beneficiary form into a participant.
 *
 * The form model always intended this - `BeneficiaryRecord.innovatorId` carries
 * the comment "set when the record is accepted and a participant profile is
 * created or linked" - and the step was never built. So onboarding produced
 * signed, accepted records that no assessment, booking, stipend or grant could
 * ever attach to, because none of those hang off a beneficiary record. They hang
 * off an InnovatorProfile.
 *
 * Kept dependency-free so the decisions are testable without a database. The
 * route does the writing; this decides what to write and when to refuse.
 */

export type LinkBlock =
  | 'already-linked'
  | 'no-cohort'
  | 'email-belongs-to-a-participant'
  | 'no-name'

export interface LinkCheck {
  allowed: boolean
  block?: LinkBlock
  reason?: string
}

export interface LinkableRecord {
  innovatorId: string | null
  cohortId: string | null
  fullName: string
}

export interface ExistingAccount {
  /** An account already using this record's email address. */
  userId: string | null
  /** Whether that account is already a participant. */
  hasInnovatorProfile: boolean
}

/**
 * Whether an accepted record can become a participant.
 *
 * The cohort requirement is the one that will surprise somebody, so: a
 * participant with no cohort cannot be assessed, does not appear in any cohort
 * report, and is invisible to every figure a funder is given. Creating one would
 * move the problem rather than solve it, and a facilitator would have to come
 * back and fix it by hand. Better to ask for the cohort at the moment somebody
 * is deciding to accept the form.
 */
export function canLink(record: LinkableRecord, account: ExistingAccount): LinkCheck {
  if (record.innovatorId) {
    return {
      allowed: false,
      block: 'already-linked',
      reason: 'This record is already linked to a participant.',
    }
  }

  if (!record.cohortId) {
    return {
      allowed: false,
      block: 'no-cohort',
      reason:
        'Assign a cohort before accepting. A participant without one cannot be assessed and appears in no cohort report.',
    }
  }

  if (splitFullName(record.fullName).firstName === '') {
    return {
      allowed: false,
      block: 'no-name',
      reason: 'This record has no usable name.',
    }
  }

  if (account.userId && account.hasInnovatorProfile) {
    return {
      allowed: false,
      block: 'email-belongs-to-a-participant',
      reason:
        'Another participant already uses this email address. Check whether this person has been captured twice.',
    }
  }

  return { allowed: true }
}

/**
 * Split a single captured name into the two fields a profile has.
 *
 * The form asks for one full name because that is what the paper form asks for;
 * the profile has firstName and lastName because every screen and export is built
 * on them. Something has to make the call.
 *
 * First token is the first name, everything after it is the surname. That keeps
 * multi-word surnames intact - "Van der Merwe", "Ka Mthembu" - which matters more
 * than handling multiple given names, because the surname is what a funder's
 * register is sorted and searched by. A single-word name becomes the first name
 * with an empty surname rather than being rejected: mononyms exist, and refusing
 * one at acceptance would strand a signed form.
 */
export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

export interface RecordForProfile {
  fullName: string
  cellphone: string | null
  projectTitle: string | null
  sector: string | null
  conceptDescription: string | null
  idNumberEncrypted: string | null
}

export interface ProfileFields {
  firstName: string
  lastName: string
  phone: string | null
  businessName: string | null
  businessSector: string | null
  bio: string | null
  idNumberEncrypted: string | null
}

/**
 * The profile fields a record supplies.
 *
 * `idNumberEncrypted` is carried across as ciphertext. There is no reason to
 * decrypt an ID number to copy it, and not decrypting means this path cannot leak
 * one into a log, an error message or a stack trace.
 *
 * The project becomes the business, because that is what the participant is
 * assessed on: TRL, BRL and IRL are scored against the venture the form
 * describes. Leaving it behind would mean a facilitator retyping it from a form
 * they have just read.
 */
export function profileFromRecord(record: RecordForProfile): ProfileFields {
  const { firstName, lastName } = splitFullName(record.fullName)
  const clean = (value: string | null) => {
    const trimmed = (value ?? '').trim()
    return trimmed === '' ? null : trimmed
  }
  return {
    firstName,
    lastName,
    phone: clean(record.cellphone),
    businessName: clean(record.projectTitle),
    businessSector: clean(record.sector),
    bio: clean(record.conceptDescription),
    idNumberEncrypted: record.idNumberEncrypted,
  }
}
