import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveTally,
  differences,
  ageAt,
  YOUTH_UNDER,
  type TallyRecord,
} from './beneficiary-tally'

/**
 * The two tests worth reading are the coverage one and the age-at-period-end one.
 *
 * Coverage: a youth count that silently includes un-ageable records reads as "no
 * young people on this programme", which is a claim nobody made.
 *
 * Age at period end: measuring age today instead means the same historical period
 * loses people to birthdays every time it is re-derived, so a report cannot be
 * reproduced.
 */

const PERIOD = {
  start: new Date('2026-01-01T00:00:00Z'),
  end: new Date('2026-03-31T23:59:59Z'),
}

function rec(over: Partial<TallyRecord> = {}): TallyRecord {
  return {
    acceptedAt: new Date('2026-02-15T10:00:00Z'),
    dateOfBirth: new Date('2000-06-01T00:00:00Z'),
    gender: 'Female',
    hasDisability: false,
    cohortId: 'cohort-1',
    ...over,
  }
}

test('counts accepted forms inside the period only', () => {
  const t = deriveTally(
    [
      rec(),
      rec({ acceptedAt: new Date('2025-12-31T23:00:00Z') }), // before
      rec({ acceptedAt: new Date('2026-04-01T00:30:00Z') }), // after
      rec({ acceptedAt: null }), // never accepted
    ],
    PERIOD
  )
  assert.equal(t.direct, 1)
})

test('a record that was never accepted is not a beneficiary', () => {
  // A captured or signed form is not somebody the programme has taken on.
  const t = deriveTally([rec({ acceptedAt: null })], PERIOD)
  assert.equal(t.direct, 0)
})

test('counts female and disability only where an answer was given', () => {
  const t = deriveTally(
    [
      rec({ gender: 'Female', hasDisability: true }),
      rec({ gender: 'Male', hasDisability: false }),
      rec({ gender: null, hasDisability: null }),
    ],
    PERIOD
  )
  assert.equal(t.direct, 3)
  assert.equal(t.female, 1)
  assert.equal(t.genderStated, 2)
  assert.equal(t.pwd, 1)
  assert.equal(t.disabilityAnswered, 2)
})

test('reports how many records it could not age, rather than calling them not youth', () => {
  const t = deriveTally(
    [
      rec({ dateOfBirth: new Date('2005-01-01T00:00:00Z') }), // young
      rec({ dateOfBirth: null }), // no ID captured, or captured before the column
      rec({ dateOfBirth: null }),
    ],
    PERIOD
  )
  assert.equal(t.direct, 3)
  assert.equal(t.youth, 1)
  assert.equal(t.ageKnown, 1)
  assert.equal(t.ageUnknown, 2)
})

test('measures age at the period end, so a past period stays reproducible', () => {
  // Turned 35 in mid 2026. Inside a Q1 2026 period they were 34 and counted; a
  // tally measured "today" in 2027 would quietly drop them.
  const born = new Date('1991-06-01T00:00:00Z')
  const q1 = deriveTally([rec({ dateOfBirth: born })], PERIOD)
  assert.equal(q1.youth, 1)

  const q4 = deriveTally(
    [rec({ dateOfBirth: born, acceptedAt: new Date('2026-11-01T00:00:00Z') })],
    {
      start: new Date('2026-10-01T00:00:00Z'),
      end: new Date('2026-12-31T23:59:59Z'),
    }
  )
  assert.equal(q4.youth, 0)
})

test('the youth boundary is under 35, not 35 and under', () => {
  const on = new Date('2026-03-31T00:00:00Z')
  const exactly35 = new Date('1991-03-31T00:00:00Z')
  const almost35 = new Date('1991-04-01T00:00:00Z')

  assert.equal(ageAt(exactly35, on), 35)
  assert.equal(ageAt(almost35, on), 34)

  const t = deriveTally(
    [
      rec({ dateOfBirth: exactly35 }),
      rec({ dateOfBirth: almost35 }),
    ],
    PERIOD
  )
  assert.equal(t.youth, 1)
  assert.equal(YOUTH_UNDER, 35)
})

test('ageAt handles a birthday that has not happened yet this year', () => {
  assert.equal(ageAt(new Date('2000-12-31T00:00:00Z'), new Date('2026-01-01T00:00:00Z')), 25)
  assert.equal(ageAt(new Date('2000-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z')), 26)
})

test('a cohort filter is exact, and no filter means the whole programme', () => {
  const rows = [rec({ cohortId: 'a' }), rec({ cohortId: 'b' }), rec({ cohortId: null })]

  assert.equal(deriveTally(rows, PERIOD).direct, 3)
  assert.equal(deriveTally(rows, { ...PERIOD, cohortId: 'a' }).direct, 1)
  // A record with no cohort is not counted towards a specific one.
  assert.equal(deriveTally(rows, { ...PERIOD, cohortId: 'b' }).direct, 1)
})

test('accepts dates as strings, which is what an API hands back', () => {
  const t = deriveTally(
    [
      {
        acceptedAt: '2026-02-01T00:00:00Z',
        dateOfBirth: '2005-01-01',
        gender: 'Female',
        hasDisability: true,
        cohortId: null,
      },
    ],
    PERIOD
  )
  assert.equal(t.direct, 1)
  assert.equal(t.youth, 1)
  assert.equal(t.female, 1)
  assert.equal(t.pwd, 1)
})

test('differences reports only what actually differs', () => {
  const derived = deriveTally([rec(), rec({ gender: 'Male' })], PERIOD)
  const d = differences({ direct: 2, female: 1, youth: 2, pwd: 0 }, derived)
  assert.deepEqual(d, [])
})

test('differences signs the delta so the direction is readable', () => {
  const derived = deriveTally([rec(), rec(), rec()], PERIOD)
  const d = differences({ direct: 1, female: 1, youth: 1, pwd: 0 }, derived)
  const direct = d.find((x) => x.field === 'direct')
  assert.equal(direct?.delta, 2)
  assert.equal(direct?.derived, 3)
  assert.equal(direct?.reported, 1)
})

test('indirect is never compared, because nothing derives it', () => {
  const derived = deriveTally([rec()], PERIOD)
  const d = differences({ direct: 1, female: 1, youth: 1, pwd: 0 }, derived)
  assert.equal(
    d.some((x) => (x.field as string) === 'indirect'),
    false
  )
})
