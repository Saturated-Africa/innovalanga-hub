/**
 * Pseudonymisation tests.
 *
 * These pin the guarantee the POPIA position rests on: when the assistant runs
 * on a remote provider (Bedrock in af-south-1 routes globally), no participant
 * or mentor name from the caller's roster survives into the payload — including
 * inside free-text fields, which is where names actually hide.
 *
 * Run:  npm run test:redact
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addMapping,
  redactText,
  redactValue,
  rehydrateText,
  isFullyRedacted,
  type PseudonymMap,
} from './ai/redact.ts'

function roster(): PseudonymMap {
  const map: PseudonymMap = { toReal: {}, toToken: {} }
  addMapping(map, 'Zanele Mahlangu', 'Participant 1')
  addMapping(map, 'Zanele', 'Participant 1')
  addMapping(map, 'Mahlangu', 'Participant 1')
  addMapping(map, 'Sizwe Solar', 'Business 1')
  addMapping(map, 'Bongani Dlamini', 'Participant 2')
  addMapping(map, 'Bongani', 'Participant 2')
  addMapping(map, 'Sipho Nkosi', 'Mentor 1')
  addMapping(map, 'Sipho', 'Mentor 1')
  return map
}

test('a full name is replaced before its parts', () => {
  const map = roster()
  assert.equal(redactText('Zanele Mahlangu is doing well', map), 'Participant 1 is doing well')
  // Not "Participant 1 Participant 1" — longest match must win.
  assert.ok(!redactText('Zanele Mahlangu', map).includes('Participant 1 Participant 1'))
})

test('a first name used alone inside prose is caught', () => {
  const map = roster()
  const note = 'Zanele arrived late but presented confidently.'
  assert.equal(redactText(note, map), 'Participant 1 arrived late but presented confidently.')
})

test('names hidden in free-text fields are redacted, not just name columns', () => {
  const map = roster()
  const toolResult = {
    id: 'abc',
    name: 'Zanele Mahlangu',
    business: 'Sizwe Solar',
    log: {
      notes: 'Sipho worked with Zanele on the pitch deck for Sizwe Solar.',
      nextSteps: 'Bongani to review.',
    },
    assessments: [{ period: 'month_3', justification: 'Mahlangu demonstrated traction.' }],
  }

  const redacted = redactValue(toolResult, map)
  assert.ok(isFullyRedacted(redacted, map), 'no roster name may survive anywhere')

  const serialised = JSON.stringify(redacted)
  for (const real of ['Zanele', 'Mahlangu', 'Bongani', 'Sipho', 'Sizwe Solar']) {
    assert.ok(!serialised.includes(real), `"${real}" leaked into the payload`)
  }
  assert.ok(serialised.includes('Participant 1'))
  assert.ok(serialised.includes('Mentor 1'))
})

test('object keys are left alone — they are schema, not data', () => {
  const map = roster()
  const redacted = redactValue({ Zanele: 'x' }, map) as Record<string, unknown>
  assert.ok('Zanele' in redacted, 'keys must not be rewritten')
})

test('redaction is case-insensitive but rehydration round-trips', () => {
  const map = roster()
  assert.equal(redactText('zanele mahlangu called', map), 'Participant 1 called')
  assert.equal(
    rehydrateText('Participant 1 called', map),
    'Zanele Mahlangu called',
    'the browser must be able to restore the display name'
  )
})

test('word boundaries prevent collateral damage inside other words', () => {
  const map: PseudonymMap = { toReal: {}, toToken: {} }
  addMapping(map, 'Ann', 'Participant 9')
  assert.equal(
    redactText('Announcement about Ann', map),
    'Announcement about Participant 9',
    'a substring match would have corrupted "Announcement"'
  )
})

test('very short values are not mapped at all', () => {
  const map: PseudonymMap = { toReal: {}, toToken: {} }
  addMapping(map, 'Jo', 'Participant 1')
  assert.deepEqual(map.toToken, {}, 'two-character names cause more damage than they prevent')
})

test('numbers, nulls and booleans pass through untouched', () => {
  const map = roster()
  const input = { score: 7, paid: null, active: true, dates: [1, 2, 3] }
  assert.deepEqual(redactValue(input, map), input)
})

test('an empty map is a no-op, which is the self-hosted Ollama path', () => {
  const empty: PseudonymMap = { toReal: {}, toToken: {} }
  const payload = { name: 'Zanele Mahlangu', notes: 'Sipho met Zanele.' }
  assert.deepEqual(redactValue(payload, empty), payload)
})
