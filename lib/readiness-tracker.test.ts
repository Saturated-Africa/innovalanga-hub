import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  movementFor,
  distribution,
  summarise,
  byCohort,
  needsAttention,
  type Participant,
} from './readiness-tracker.ts'

const PERIODS = ['baseline', 'month_3', 'month_6', 'month_9', 'final']

function person(
  id: string,
  scores: [string, number][],
  cohortName: string | null = 'Cohort A'
): Participant {
  return {
    id,
    name: `Person ${id}`,
    cohortId: 'c1',
    cohortName,
    history: scores.map(([period, score], i) => ({
      period,
      score,
      assessedAt: new Date(Date.UTC(2026, i, 1)),
    })),
  }
}

test('delta compares the two most recent periods', () => {
  const m = movementFor(person('a', [['baseline', 3], ['month_3', 5]]), PERIODS)
  assert.equal(m.current, 5)
  assert.equal(m.previous, 3)
  assert.equal(m.delta, 2)
  assert.equal(m.currentPeriod, 'month_3')
})

test('period order wins over the order the rows arrive in', () => {
  // Assessments are frequently backfilled. Ordering by capture date would make
  // a late-entered Month 3 look like the most recent and invert the delta.
  const backfilled: Participant = {
    id: 'b',
    name: 'Person b',
    cohortId: 'c1',
    cohortName: 'Cohort A',
    history: [
      { period: 'month_6', score: 7, assessedAt: new Date(Date.UTC(2026, 0, 1)) },
      { period: 'month_3', score: 5, assessedAt: new Date(Date.UTC(2026, 6, 1)) },
    ],
  }
  const m = movementFor(backfilled, PERIODS)
  assert.equal(m.current, 7, 'month_6 is the later period regardless of capture date')
  assert.equal(m.previous, 5)
  assert.equal(m.delta, 2)
})

test('a single assessment is not stalled', () => {
  // One baseline means nobody has re-assessed them, not that they stopped.
  const m = movementFor(person('c', [['baseline', 4]]), PERIODS)
  assert.equal(m.delta, null)
  assert.equal(m.stalled, false)
  assert.equal(m.periodsAssessed, 1)
})

test('no movement across two periods is stalled', () => {
  const m = movementFor(person('d', [['baseline', 4], ['month_3', 4]]), PERIODS)
  assert.equal(m.delta, 0)
  assert.equal(m.stalled, true)
  assert.equal(m.regressed, false)
})

test('going backwards is flagged separately from stalling', () => {
  const m = movementFor(person('e', [['baseline', 6], ['month_3', 4]]), PERIODS)
  assert.equal(m.delta, -2)
  assert.equal(m.regressed, true)
  assert.equal(m.stalled, false)
})

test('an unknown period is ignored rather than ranked first', () => {
  // A period key that is not in the programme's own list must not silently
  // become the newest or oldest entry.
  const m = movementFor(person('f', [['baseline', 3], ['not_a_period', 9]]), PERIODS)
  assert.equal(m.current, 3)
  assert.equal(m.periodsAssessed, 1)
})

test('someone never assessed has no score rather than a zero', () => {
  const m = movementFor(person('g', []), PERIODS)
  assert.equal(m.current, null)
  assert.equal(m.delta, null)
  assert.equal(m.stalled, false)
})

test('distribution covers every level, including empty ones', () => {
  const ms = [
    movementFor(person('a', [['baseline', 1]]), PERIODS),
    movementFor(person('b', [['baseline', 1]]), PERIODS),
    movementFor(person('c', [['baseline', 9]]), PERIODS),
  ]
  const d = distribution(ms)
  assert.equal(d.length, 9, 'a level with nobody in it still needs a bar')
  assert.equal(d.find((x) => x.level === 1)?.count, 2)
  assert.equal(d.find((x) => x.level === 5)?.count, 0)
  assert.equal(d.find((x) => x.level === 9)?.count, 1)
})

test('summary counts each movement type and excludes the unassessed', () => {
  const ms = [
    movementFor(person('a', [['baseline', 2], ['month_3', 4]]), PERIODS), // advancing
    movementFor(person('b', [['baseline', 5], ['month_3', 5]]), PERIODS), // stalled
    movementFor(person('c', [['baseline', 7], ['month_3', 6]]), PERIODS), // regressed
    movementFor(person('d', [['baseline', 8]]), PERIODS), // near ready
    movementFor(person('e', []), PERIODS), // never assessed
  ]
  const s = summarise(ms)
  assert.equal(s.assessed, 4)
  assert.equal(s.notAssessed, 1)
  assert.equal(s.advancing, 1)
  assert.equal(s.stalled, 1)
  assert.equal(s.regressed, 1)
  assert.equal(s.nearReady, 1, 'level 8 and 9 count as near ready')
  assert.equal(s.average, (4 + 5 + 6 + 8) / 4)
})

test('an empty programme averages null rather than zero', () => {
  // Zero would render as a real score and drag a cohort chart to the floor.
  const s = summarise([])
  assert.equal(s.average, null)
  assert.equal(s.assessed, 0)
})

test('cohort averages group by cohort and rank highest first', () => {
  const ms = [
    movementFor(person('a', [['baseline', 8]], 'Northern'), PERIODS),
    movementFor(person('b', [['baseline', 6]], 'Northern'), PERIODS),
    movementFor(person('c', [['baseline', 2]], 'Southern'), PERIODS),
    movementFor(person('d', [['baseline', 4]], null), PERIODS),
  ]
  const rows = byCohort(ms)
  assert.equal(rows[0].cohortName, 'Northern')
  assert.equal(rows[0].average, 7)
  assert.equal(rows[0].count, 2)
  assert.equal(rows.at(-1)?.cohortName, 'Southern')
  assert.ok(rows.some((r) => r.cohortName === 'Unassigned'))
})

test('attention list puts regression above stalling, lowest score first', () => {
  const ms = [
    movementFor(person('stall-high', [['baseline', 7], ['month_3', 7]]), PERIODS),
    movementFor(person('stall-low', [['baseline', 2], ['month_3', 2]]), PERIODS),
    movementFor(person('regressed', [['baseline', 8], ['month_3', 6]]), PERIODS),
    movementFor(person('advancing', [['baseline', 2], ['month_3', 5]]), PERIODS),
  ]
  const list = needsAttention(ms)
  assert.equal(list.length, 3, 'the advancing participant is not on the list')
  assert.equal(list[0].id, 'regressed')
  assert.equal(list[1].id, 'stall-low')
  assert.equal(list[2].id, 'stall-high')
})
