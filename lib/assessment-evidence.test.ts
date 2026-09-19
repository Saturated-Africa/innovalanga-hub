import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  unevidencedRises,
  evidenceCoverage,
  describeGap,
  type Scores,
} from './assessment-evidence'

/**
 * The rule under test is the symmetry: the platform already requires a written
 * reason when a score drops more than two points, and a rise - the direction a
 * funder is being asked to pay for - was unguarded entirely.
 */

const baseline: Scores = { trl: 3, brl: 3, mrl: 3, irl: 3 }

test('a rise with no evidence is reported', () => {
  const gaps = unevidencedRises(baseline, { ...baseline, brl: 5 }, {})
  assert.equal(gaps.length, 1)
  assert.deepEqual(gaps[0], { dimension: 'brl', from: 3, to: 5 })
})

test('a rise with evidence attached is not reported', () => {
  const gaps = unevidencedRises(baseline, { ...baseline, brl: 5 }, { brl: 1 })
  assert.deepEqual(gaps, [])
})

test('a score that stays the same is not a claim needing evidence', () => {
  assert.deepEqual(unevidencedRises(baseline, baseline, {}), [])
})

test('a drop is not reported here - the existing justification rule covers it', () => {
  const gaps = unevidencedRises(baseline, { ...baseline, trl: 1 }, {})
  assert.deepEqual(gaps, [])
})

test('a baseline reports nothing, because there is no rise to evidence', () => {
  // The point of a baseline is to record where somebody started, and it is exactly
  // where evidence is thinnest. Demanding it there would make the first assessment
  // of every participant a fight.
  assert.deepEqual(unevidencedRises(null, { trl: 7, brl: 7, mrl: 7, irl: 7 }, {}), [])
})

test('several unevidenced rises are all reported, not just the first', () => {
  const gaps = unevidencedRises(
    baseline,
    { trl: 4, brl: 6, mrl: 3, irl: 5 },
    { brl: 2 } // only BRL is backed
  )
  assert.deepEqual(
    gaps.map((g) => g.dimension),
    ['trl', 'irl']
  )
})

test('a null MRL is skipped rather than treated as zero', () => {
  // MRL is nullable in the schema: older assessments predate it. Treating null as 0
  // would report a rise from nothing every time it is first scored.
  assert.deepEqual(unevidencedRises({ ...baseline, mrl: null }, { ...baseline, mrl: 6 }, {}), [])
  assert.deepEqual(unevidencedRises(baseline, { ...baseline, mrl: null }, {}), [])
})

test('coverage counts the dimensions that are scored, not four regardless', () => {
  const withoutMrl: Scores = { trl: 4, brl: 4, mrl: null, irl: 4 }
  const c = evidenceCoverage(withoutMrl, { trl: 1 })
  assert.equal(c.scored, 3)
  assert.equal(c.backed, 1)
  assert.equal(Math.round(c.ratio * 100), 33)
})

test('coverage is zero rather than NaN when nothing is scored', () => {
  const none: Scores = { trl: null as unknown as number, brl: null as unknown as number, mrl: null, irl: null as unknown as number }
  assert.equal(evidenceCoverage(none, {}).ratio, 0)
})

test('full coverage reads as one', () => {
  const c = evidenceCoverage(baseline, { trl: 1, brl: 3, mrl: 1, irl: 2 })
  assert.equal(c.scored, 4)
  assert.equal(c.backed, 4)
  assert.equal(c.ratio, 1)
})

test('a gap describes itself in words a funder would understand', () => {
  const text = describeGap({ dimension: 'brl', from: 3, to: 6 }, 'BRL')
  assert.match(text, /BRL rose from 3 to 6/)
  assert.match(text, /no document attached/)
})
