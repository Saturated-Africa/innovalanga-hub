import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RUBRIC, SCORING_RULES, levelFor, type RubricDimension } from './readiness-rubric'
import { getTRLLabel, getBRLLabel, getIRLLabel, getMRLLabel } from './utils'

/**
 * The test that matters here is the name one.
 *
 * Assessments already recorded are numbers against the level names in lib/utils.ts.
 * If this rubric and those labels drift apart, an assessor reads one definition
 * while the score is stored, charted and reported against another - and nothing
 * anywhere would complain. Every historical trajectory would silently change
 * meaning.
 */

const LABELS: Record<RubricDimension, (n: number) => string> = {
  trl: getTRLLabel,
  brl: getBRLLabel,
  mrl: getMRLLabel,
  irl: getIRLLabel,
}

const DIMENSIONS: RubricDimension[] = ['trl', 'brl', 'mrl', 'irl']

test('every level name matches the label the platform already uses', () => {
  for (const key of DIMENSIONS) {
    for (const level of RUBRIC[key].levels) {
      assert.equal(
        level.name,
        LABELS[key](level.level),
        `${key} ${level.level}: rubric says "${level.name}", the platform says "${LABELS[key](level.level)}"`
      )
    }
  }
})

test('all four dimensions have exactly nine levels, numbered 1 to 9 in order', () => {
  for (const key of DIMENSIONS) {
    const levels = RUBRIC[key].levels
    assert.equal(levels.length, 9, key)
    assert.deepEqual(
      levels.map((l) => l.level),
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
      key
    )
  }
})

test('every level says what is required and what proves it', () => {
  // A level with empty criteria is a level an assessor will fill in from
  // imagination, which is the situation this rubric exists to end.
  for (const key of DIMENSIONS) {
    for (const level of RUBRIC[key].levels) {
      assert.ok(level.criteria.trim().length > 30, `${key} ${level.level} criteria too thin`)
      assert.ok(level.evidence.trim().length > 10, `${key} ${level.level} evidence too thin`)
    }
  }
})

test('criteria are distinct, so two levels cannot be the same bar twice', () => {
  for (const key of DIMENSIONS) {
    const criteria = RUBRIC[key].levels.map((l) => l.criteria)
    assert.equal(new Set(criteria).size, criteria.length, key)
  }
})

test('each dimension states the question it answers', () => {
  for (const key of DIMENSIONS) {
    assert.ok(RUBRIC[key].question.includes('?'), key)
    assert.ok(RUBRIC[key].code.length >= 3, key)
    assert.ok(RUBRIC[key].title.length > 0, key)
  }
})

test('levelFor returns the level, and nothing for a score off the scale', () => {
  assert.equal(levelFor('brl', 6)?.name, 'Early Revenue')
  assert.equal(levelFor('trl', 1)?.name, 'Basic Principles')
  assert.equal(levelFor('mrl', 0), null)
  assert.equal(levelFor('irl', 10), null)
})

test('the scoring rules include the two that hold the scale together', () => {
  const joined = SCORING_RULES.join(' ').toLowerCase()
  // Without "every criterion" a partial match becomes a level. Without "no
  // skipping" the ladder stops being cumulative and movement stops meaning
  // anything between periods.
  assert.match(joined, /every criterion/)
  assert.match(joined, /no skipping/)
  assert.match(joined, /evidence is not on file/)
})

test('South African conditions are in the criteria, not left implied', () => {
  // The point of writing our own rubric rather than using the generic definitions.
  const trl5 = levelFor('trl', 5)
  assert.match(trl5?.criteria ?? '', /grid power/i)

  const brl6 = levelFor('brl', 6)
  assert.match(brl6?.evidence ?? '', /SARS/)
  assert.match(brl6?.evidence ?? '', /B-BBEE/)
  assert.match(brl6?.evidence ?? '', /CSD/)

  // Informal routes count on the same terms as formal retail.
  const mrl6 = levelFor('mrl', 6)
  assert.match(mrl6?.evidence ?? '', /spaza/i)
})
