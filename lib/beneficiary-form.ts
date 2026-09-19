import { z } from 'zod'
import { createHash } from 'crypto'

/**
 * The Beneficiary Capturing Form, as data.
 *
 * The funder supplies this form on paper and expects it back field for field,
 * so the field list, their order, and the exact option sets are reproduced here
 * rather than reinterpreted. Where the paper form offers a fixed choice - a
 * gender, a race, a title, yes or no - the choice is an enum. Where it offers a
 * ruled line, it is free text.
 *
 * This module is the single definition. The capture screen, the validation on
 * the API, and the printable version all read from it, so the thing a person
 * signs and the thing that prints cannot drift apart.
 *
 * Deliberately dependency-free beyond zod so the shape can be tested on its own.
 */

export const TITLES = ['Mr', 'Ms', 'Mrs', 'Other'] as const
export const GENDERS = ['Male', 'Female'] as const
export const RACES = ['Black', 'White', 'Other'] as const

/** The nine provinces. The paper form leaves a ruled line; a list is better data. */
export const PROVINCES = [
  'Eastern Cape',
  'Free State',
  'Gauteng',
  'KwaZulu-Natal',
  'Limpopo',
  'Mpumalanga',
  'Northern Cape',
  'North West',
  'Western Cape',
] as const

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v))

/**
 * A draft may be incomplete: the form is often captured across a conversation.
 * Completeness is enforced at signing, not at every keystroke.
 */
export const beneficiaryDraftSchema = z.object({
  cohortId: z.string().min(1).optional(),

  // Personal information
  fullName: z.string().trim().min(2).max(120),
  idNumber: z
    .string()
    .trim()
    .regex(/^\d{13}$/, 'A South African ID number is 13 digits')
    .optional()
    .or(z.literal('')),
  /**
   * Asked for directly, as well as derived from an ID number.
   *
   * The ID is optional and always will be - people arrive without documents, and
   * a form that cannot be signed is a person who cannot be enrolled - so
   * deriving the date from it covers only some records. Asking outright is what
   * makes a youth figure answerable for the rest.
   */
  dateOfBirth: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker')
    .optional()
    .or(z.literal('')),
  gender: z.enum(GENDERS).optional(),
  hasDisability: z.boolean().optional(),
  race: z.enum(RACES).optional(),
  raceOther: optionalText(60),
  title: z.enum(TITLES).optional(),
  titleOther: optionalText(60),

  // Personal contact details
  physicalAddress: optionalText(500),
  cellphone: optionalText(20),
  localMunicipality: optionalText(120),
  alternativeNumber: optionalText(20),
  districtMunicipality: optionalText(120),
  email: z.string().trim().email().max(255),
  province: z.enum(PROVINCES).optional(),

  /**
   * The entity, where there is one.
   *
   * All optional. A sole proprietor has no registration number, and most people
   * arriving on this programme are not registered at all - refusing to capture
   * somebody for that would exclude the people it exists for.
   *
   * The number is checked against the entity type rather than stored blind: the
   * last two digits of a CIPC number say what kind of entity it is, so the two
   * fields can contradict each other and that is worth catching here.
   */
  entityType: z
    .enum([
      'PtyLtd',
      'NPC',
      'CloseCorporation',
      'SoleProprietor',
      'Trust',
      'Cooperative',
      'Other',
    ])
    .optional(),
  entityRegistrationNumber: optionalText(40),
  entityName: optionalText(200),

  // Project details
  hasInnovativeIdea: z.boolean().optional(),
  conceptDescription: optionalText(4000),
  projectTitle: optionalText(200),
  developmentStage: optionalText(200),
  sector: optionalText(200),
  supportRequired: optionalText(2000),
  otherInformation: optionalText(2000),
})

export type BeneficiaryDraft = z.infer<typeof beneficiaryDraftSchema>

/**
 * Fields the funder needs present before a form can be signed.
 *
 * A blank demographic column is the one thing that makes a beneficiary report
 * unusable, so those are required here even though the paper form relies on
 * whoever is holding the pen.
 */
export const REQUIRED_TO_SIGN = [
  'fullName',
  'email',
  'gender',
  'race',
  'title',
  'province',
  'cellphone',
  'physicalAddress',
] as const

export function missingBeforeSigning(
  draft: Record<string, unknown>
): string[] {
  // Widened to string: the conditional checks below add fields that are not
  // in the fixed required list, and a narrowed literal type would reject them.
  const missing: string[] = REQUIRED_TO_SIGN.filter((field) => {
    const value = draft[field]
    return value === undefined || value === null || value === ''
  })

  // "Other" is only an answer once it says what the other is.
  if (draft.race === 'Other' && !draft.raceOther) missing.push('raceOther')
  if (draft.title === 'Other' && !draft.titleOther) missing.push('titleOther')

  // A yes/no left blank is not the same as "no", and the funder counts it.
  if (draft.hasDisability === undefined || draft.hasDisability === null) {
    missing.push('hasDisability')
  }

  return missing
}

/** Human labels, used in validation messages and on the printed form. */
export const FIELD_LABELS: Record<string, string> = {
  fullName: 'Name and Surname',
  idNumber: 'ID Number',
  dateOfBirth: 'Date of birth',
  gender: 'Gender',
  hasDisability: 'Are you disabled?',
  race: 'Race',
  raceOther: 'Race (other)',
  title: 'Title',
  titleOther: 'Title (other)',
  physicalAddress: 'Physical Address',
  cellphone: 'Cellphone No',
  localMunicipality: 'Local Municipality',
  alternativeNumber: 'Alternative No',
  districtMunicipality: 'District Municipality',
  email: 'Email address',
  province: 'Province',
  hasInnovativeIdea: 'Do you have an innovative idea?',
  conceptDescription:
    'Description of proposed innovative business, social or technology concept',
  entityType: 'Entity type',
  entityRegistrationNumber: 'Registration number',
  entityName: 'Registered name',
  projectTitle: 'Project title',
  developmentStage: 'Stage of development',
  sector: 'Sector that the innovation falls under',
  supportRequired: 'Type of support required',
  otherInformation: 'Any other key information',
}

/**
 * The order in which answers are hashed. Fixed and explicit, because a hash
 * over an object is only stable if the key order is.
 */
const HASHED_FIELDS = [
  'fullName',
  'gender',
  'hasDisability',
  'race',
  'raceOther',
  'title',
  'titleOther',
  'physicalAddress',
  'cellphone',
  'localMunicipality',
  'alternativeNumber',
  'districtMunicipality',
  'email',
  'province',
  'hasInnovativeIdea',
  'conceptDescription',
  'projectTitle',
  'developmentStage',
  'sector',
  'supportRequired',
  'otherInformation',
] as const

/**
 * A fingerprint of exactly what was signed.
 *
 * Taken at the moment of signature and stored beside it. If any answer is
 * altered afterwards, this no longer matches, which is what separates a
 * signature from a decoration. The ID number is deliberately excluded: it is
 * held encrypted with a per-value salt, so its ciphertext changes on every
 * write and would make the hash unstable for no gain.
 */
export function hashAnswers(draft: Record<string, unknown>): string {
  const canonical = HASHED_FIELDS.map((field) => {
    const value = draft[field]
    const rendered =
      value === undefined || value === null ? '' : String(value).trim()
    return `${field}=${rendered}`
  }).join('\n')

  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

/**
 * Derive date of birth and gender from a South African ID number.
 *
 * The first six digits are the birth date and the seventh indicates gender, so
 * two of the funder's demographic columns are already inside a number the
 * beneficiary has given. Deriving them lets a contradiction be caught at
 * capture, rather than surfacing later as a report that disagrees with itself.
 *
 * Returns null when the number is not the expected shape.
 */
export interface DateOfBirthResolution {
  ok: boolean
  /** The date to store, when ok. */
  dateOfBirth: Date | null
  /** Why it was refused, when not ok. */
  error?: string
  /** True when the value came from the ID rather than from what was typed. */
  derived: boolean
}

/**
 * Settle a date of birth from what was typed and what the ID number implies.
 *
 * A mismatch is refused rather than silently preferring one. Both are meant to be
 * the same person's birth date, so a disagreement means one of them is mistyped -
 * and one of them is an identity number, where a typo matters well beyond a youth
 * count. Refusing names both dates so whoever is looking at the form can see which
 * is wrong.
 *
 * With no ID, the typed date is taken as given. With no typed date, the ID
 * supplies it. With neither, there is nothing to store and that is not an error:
 * an unknown age is reported as unknown rather than guessed.
 */
export function resolveDateOfBirth(input: {
  typed?: string | null
  idNumber?: string | null
  /** Today, passed in so this stays pure. */
  today?: Date
}): DateOfBirthResolution {
  const today = input.today ?? new Date()
  const typedText = (input.typed ?? '').trim()
  const idText = (input.idNumber ?? '').trim()

  let typed: Date | null = null
  if (typedText !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(typedText)) {
      return { ok: false, dateOfBirth: null, derived: false, error: 'Use the date picker.' }
    }
    typed = new Date(`${typedText}T00:00:00.000Z`)
    if (Number.isNaN(typed.getTime())) {
      return { ok: false, dateOfBirth: null, derived: false, error: 'That is not a date.' }
    }
    if (typed > today) {
      return {
        ok: false,
        dateOfBirth: null,
        derived: false,
        error: 'A date of birth cannot be in the future.',
      }
    }
    // A century and a bit. Catches a mistyped year without arguing about anybody
    // real: the oldest verified person reached 122.
    const oldest = new Date(
      Date.UTC(today.getUTCFullYear() - 130, today.getUTCMonth(), today.getUTCDate())
    )
    if (typed < oldest) {
      return {
        ok: false,
        dateOfBirth: null,
        derived: false,
        error: 'That year looks mistyped.',
      }
    }
  }

  const fromId = idText === '' ? null : (deriveFromIdNumber(idText)?.dateOfBirth ?? null)

  if (typed && fromId) {
    const same = typed.toISOString().slice(0, 10) === fromId.toISOString().slice(0, 10)
    if (!same) {
      return {
        ok: false,
        dateOfBirth: null,
        derived: false,
        error:
          `The ID number says ${fromId.toISOString().slice(0, 10)} and the date of birth ` +
          `says ${typed.toISOString().slice(0, 10)}. One of them is mistyped.`,
      }
    }
    return { ok: true, dateOfBirth: typed, derived: false }
  }

  if (typed) return { ok: true, dateOfBirth: typed, derived: false }
  if (fromId) return { ok: true, dateOfBirth: fromId, derived: true }
  return { ok: true, dateOfBirth: null, derived: false }
}

export function deriveFromIdNumber(
  idNumber: string
): { dateOfBirth: Date; gender: 'Male' | 'Female' } | null {
  if (!/^\d{13}$/.test(idNumber)) return null

  const yy = Number(idNumber.slice(0, 2))
  const mm = Number(idNumber.slice(2, 4))
  const dd = Number(idNumber.slice(4, 6))
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null

  // Two-digit years: anything that would place the person in the future is the
  // previous century.
  const currentYear = new Date().getFullYear()
  const century = 2000 + yy <= currentYear ? 2000 : 1900
  const dateOfBirth = new Date(Date.UTC(century + yy, mm - 1, dd))
  if (Number.isNaN(dateOfBirth.getTime())) return null

  // Sequence 0000-4999 female, 5000-9999 male.
  const sequence = Number(idNumber.slice(6, 10))
  const gender = sequence < 5000 ? 'Female' : 'Male'

  return { dateOfBirth, gender }
}

/** Age in whole years at a given date. Used for the under-35 youth figure. */
export function ageAt(dateOfBirth: Date, at: Date = new Date()): number {
  let age = at.getUTCFullYear() - dateOfBirth.getUTCFullYear()
  const monthDiff = at.getUTCMonth() - dateOfBirth.getUTCMonth()
  if (monthDiff < 0 || (monthDiff === 0 && at.getUTCDate() < dateOfBirth.getUTCDate())) {
    age -= 1
  }
  return age
}
