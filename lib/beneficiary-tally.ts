/**
 * Counting beneficiaries from the forms, to compare against what was reported.
 *
 * Deliberately not a replacement for BeneficiaryCount. Those rows are figures
 * somebody has already given a funder, with their name against them. Silently
 * overwriting a reported number from a background derivation would be the worst
 * kind of helpful: the platform would disagree with a submitted report and nobody
 * would know which one moved.
 *
 * So this derives a tally and shows it beside the manual entry. Where they differ
 * a person decides, which is the correct division of labour - the difference is
 * usually a real story, like forms captured after the report went out.
 *
 * Two figures are honestly out of reach and say so rather than reading zero:
 *
 *   indirect   a judgement about people reached without being enrolled. No
 *              record exists to count, and inventing one would be a guess
 *              wearing a number's clothes.
 *   youth      needs an age. Records captured before a date of birth was stored,
 *              or with no ID number at all, cannot be aged - so the tally reports
 *              its own coverage instead of counting them as over 35.
 */

export const YOUTH_UNDER = 35

export interface TallyRecord {
  acceptedAt: Date | string | null
  dateOfBirth: Date | string | null
  gender: 'Male' | 'Female' | null
  hasDisability: boolean | null
  cohortId: string | null
}

export interface DerivedTally {
  /** Accepted forms inside the period. */
  direct: number
  female: number
  pwd: number
  /** Under YOUTH_UNDER at the period end, among those that can be aged. */
  youth: number
  /** How many of `direct` carry a date of birth, so `youth` can be read fairly. */
  ageKnown: number
  /** Records with no date of birth. `youth` says nothing about these. */
  ageUnknown: number
  /** How many gave a disability answer either way. */
  disabilityAnswered: number
  /** How many stated a gender. */
  genderStated: number
}

function asDate(value: Date | string | null): Date | null {
  if (value === null) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Whole years old at a given moment.
 *
 * Calendar arithmetic rather than dividing milliseconds: a person born on 29
 * February, or in a year where a leap day falls between the two dates, comes out
 * a year wrong from a millisecond division often enough to matter on a boundary
 * of exactly 35.
 */
export function ageAt(dateOfBirth: Date, on: Date): number {
  let age = on.getUTCFullYear() - dateOfBirth.getUTCFullYear()
  const monthDiff = on.getUTCMonth() - dateOfBirth.getUTCMonth()
  if (monthDiff < 0 || (monthDiff === 0 && on.getUTCDate() < dateOfBirth.getUTCDate())) {
    age -= 1
  }
  return age
}

/**
 * Tally the accepted forms falling inside a period.
 *
 * Age is measured at the period end, not today. A report covering last year's
 * quarter must say what was true then, or the same period re-derived next year
 * quietly loses people to birthdays.
 */
export function deriveTally(
  records: TallyRecord[],
  period: { start: Date; end: Date; cohortId?: string | null }
): DerivedTally {
  const inPeriod = records.filter((r) => {
    const accepted = asDate(r.acceptedAt)
    if (!accepted) return false
    if (accepted < period.start || accepted > period.end) return false
    // An absent cohort filter means the whole programme; a present one is exact,
    // so a record with no cohort is not counted towards a specific cohort.
    if (period.cohortId != null && r.cohortId !== period.cohortId) return false
    return true
  })

  let female = 0
  let genderStated = 0
  let pwd = 0
  let disabilityAnswered = 0
  let youth = 0
  let ageKnown = 0

  for (const r of inPeriod) {
    if (r.gender !== null) {
      genderStated += 1
      if (r.gender === 'Female') female += 1
    }
    if (r.hasDisability !== null) {
      disabilityAnswered += 1
      if (r.hasDisability) pwd += 1
    }
    const dob = asDate(r.dateOfBirth)
    if (dob) {
      ageKnown += 1
      if (ageAt(dob, period.end) < YOUTH_UNDER) youth += 1
    }
  }

  return {
    direct: inPeriod.length,
    female,
    pwd,
    youth,
    ageKnown,
    ageUnknown: inPeriod.length - ageKnown,
    disabilityAnswered,
    genderStated,
  }
}

export interface Difference {
  field: 'direct' | 'female' | 'youth' | 'pwd'
  reported: number
  derived: number
  /** derived - reported. Positive means the forms show more than was reported. */
  delta: number
}

/**
 * Where a reported row and the forms disagree.
 *
 * `indirect` is never compared, because nothing derives it. Comparing a reported
 * indirect figure against a derived zero would produce a difference that is
 * entirely an artefact of this code, and a person chasing it would find nothing.
 */
export function differences(
  reported: { direct: number; female: number; youth: number; pwd: number },
  derived: DerivedTally
): Difference[] {
  const fields: Difference['field'][] = ['direct', 'female', 'youth', 'pwd']
  return fields
    .map((field) => ({
      field,
      reported: reported[field],
      derived: derived[field],
      delta: derived[field] - reported[field],
    }))
    .filter((d) => d.delta !== 0)
}
