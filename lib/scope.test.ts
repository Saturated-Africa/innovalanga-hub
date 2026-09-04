/**
 * Tests for the assistant's authorisation boundary.
 *
 * `lib/ai/scope.ts` decides what every assistant tool is allowed to read, so a
 * regression here is a data-leak, not a cosmetic bug. These cover the pure
 * predicates only — no database required.
 *
 * Run:  npm run test:scope
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  innovatorWhere,
  bookingWhere,
  assessmentWhere,
  programmeWhere,
  type ScopedContext,
  type ScopeRole,
} from './scope-rules.ts'

function ctx(role: ScopeRole, over: Partial<ScopedContext> = {}): ScopedContext {
  return {
    userId: 'u1',
    role,
    programmeId: 'prog1',
    innovatorId: role === 'innovator' ? 'inv1' : null,
    mentorId: role === 'mentor' ? 'men1' : null,
    canSeePII: role !== 'funder_viewer',
    modules: { stipends: true, ip: true, mande: true },
    participantLabel: 'innovator',
    programmeName: 'TIA CIE',
    currencySymbol: 'R',
    ...over,
  }
}

test('funder_viewer can reach no personal records at all', () => {
  const c = ctx('funder_viewer')
  assert.equal(innovatorWhere(c), null, 'innovators must be unreachable')
  assert.equal(bookingWhere(c), null, 'bookings must be unreachable')
  assert.equal(assessmentWhere(c), null, 'assessments must be unreachable')
  assert.equal(c.canSeePII, false)
  // Aggregates remain available.
  assert.deepEqual(programmeWhere(c), { programmeId: 'prog1' })
})

test('an innovator is pinned to their own record', () => {
  const c = ctx('innovator')
  assert.deepEqual(innovatorWhere(c), { id: 'inv1' })
  assert.deepEqual(bookingWhere(c), { innovatorId: 'inv1' })
  assert.deepEqual(assessmentWhere(c), { innovatorId: 'inv1' })
})

test('an innovator with no profile gets no access rather than unfiltered access', () => {
  const c = ctx('innovator', { innovatorId: null })
  assert.equal(innovatorWhere(c), null)
  assert.equal(bookingWhere(c), null)
})

test('a mentor sees only their own bookings and mentees', () => {
  const c = ctx('mentor')
  assert.deepEqual(bookingWhere(c), { mentorId: 'men1' })
  assert.deepEqual(innovatorWhere(c), {
    bookings: { some: { mentorId: 'men1' } },
  })
})

test('a mentor with no profile gets no access', () => {
  const c = ctx('mentor', { mentorId: null })
  assert.equal(bookingWhere(c), null)
  assert.equal(innovatorWhere(c), null)
})

test('programme-wide roles are still fenced to their own programme', () => {
  for (const role of ['super_admin', 'facilitator'] as ScopeRole[]) {
    const c = ctx(role)
    assert.deepEqual(
      innovatorWhere(c),
      { cohort: { programmeId: 'prog1' } },
      `${role} must be scoped through the cohort`
    )
    assert.deepEqual(bookingWhere(c), {
      innovator: { cohort: { programmeId: 'prog1' } },
    })
  }
})

test('no programme resolved means no access, never a missing filter', () => {
  const c = ctx('facilitator', { programmeId: null })
  assert.equal(innovatorWhere(c), null)
  assert.equal(bookingWhere(c), null)
  assert.equal(programmeWhere(c), null)
})

test('every predicate returns null or an object — never undefined', () => {
  const roles: ScopeRole[] = [
    'super_admin',
    'facilitator',
    'mentor',
    'innovator',
    'funder_viewer',
  ]
  for (const role of roles) {
    for (const fn of [innovatorWhere, bookingWhere, assessmentWhere, programmeWhere]) {
      const out = fn(ctx(role))
      assert.ok(
        out === null || typeof out === 'object',
        `${role}/${fn.name} returned ${String(out)}`
      )
    }
  }
})
