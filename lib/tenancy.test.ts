/**
 * Multi-tenant isolation tests.
 *
 * The platform is being taken to multiple funders, so cross-programme leakage
 * moves from "latent" to "breach". These tests pin the two rules that were
 * actually violated in the code before this change:
 *
 *   1. `programmeId` is derived from the session, never from a query string or
 *      request body.
 *   2. A scope predicate that cannot resolve a programme returns null, meaning
 *      "no rows" — never an empty/undefined filter, which Prisma silently drops
 *      and which turned a null programme into "return everything".
 *
 * Run:  npm run test:tenancy
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

function ctx(role: ScopeRole, programmeId: string | null, over: Partial<ScopedContext> = {}): ScopedContext {
  return {
    userId: 'u1',
    role,
    programmeId,
    innovatorId: role === 'innovator' ? 'inv1' : null,
    mentorId: role === 'mentor' ? 'men1' : null,
    canSeePII: role !== 'funder_viewer',
    modules: { stipends: true, ip: true, mande: true },
    participantLabel: 'innovator',
    programmeName: 'Programme A',
    currencySymbol: 'R',
    ...over,
  }
}

/** Every filter must mention the caller's programme somewhere. */
function mentionsProgramme(filter: unknown, programmeId: string): boolean {
  return JSON.stringify(filter).includes(programmeId)
}

test('a facilitator on programme A cannot produce a filter naming programme B', () => {
  const a = ctx('facilitator', 'programme-a')
  for (const fn of [innovatorWhere, bookingWhere, assessmentWhere, programmeWhere]) {
    const filter = fn(a)
    assert.ok(filter, `${fn.name} should produce a filter`)
    assert.ok(
      mentionsProgramme(filter, 'programme-a'),
      `${fn.name} must scope to the caller's own programme`
    )
    assert.ok(
      !JSON.stringify(filter).includes('programme-b'),
      `${fn.name} must not reference another programme`
    )
  }
})

test('two facilitators on different programmes get different filters', () => {
  const a = innovatorWhere(ctx('facilitator', 'programme-a'))
  const b = innovatorWhere(ctx('facilitator', 'programme-b'))
  assert.notDeepEqual(a, b, 'scoping must actually differ between tenants')
})

test('an unresolvable programme yields null, not an empty filter', () => {
  // This is the exact shape of the bug that was in app/api/ip/route.ts:
  // `programmeId: pid ?? undefined` — Prisma drops an undefined filter, so a
  // null programme returned every tenant's rows instead of none.
  const none = ctx('facilitator', null)
  for (const fn of [innovatorWhere, bookingWhere, assessmentWhere, programmeWhere]) {
    const filter = fn(none)
    assert.equal(filter, null, `${fn.name} must fail closed`)
    assert.notDeepEqual(filter, {}, `${fn.name} must never return a match-everything filter`)
  }
})

test('no predicate ever returns an empty object', () => {
  const roles: ScopeRole[] = ['super_admin', 'facilitator', 'mentor', 'innovator', 'funder_viewer']
  for (const role of roles) {
    for (const programmeId of ['programme-a', null]) {
      for (const fn of [innovatorWhere, bookingWhere, assessmentWhere, programmeWhere]) {
        const filter = fn(ctx(role, programmeId))
        if (filter !== null) {
          assert.ok(
            Object.keys(filter).length > 0,
            `${role}/${fn.name} returned {} which matches every row in the table`
          )
        }
      }
    }
  }
})

test('funder_viewer reaches aggregates but no person-level table', () => {
  const f = ctx('funder_viewer', 'programme-a')
  assert.equal(innovatorWhere(f), null)
  assert.equal(bookingWhere(f), null)
  assert.equal(assessmentWhere(f), null)
  assert.deepEqual(programmeWhere(f), { programmeId: 'programme-a' })
  assert.equal(f.canSeePII, false)
})

test('an innovator stays pinned to their own record regardless of programme', () => {
  const i = ctx('innovator', 'programme-a')
  assert.deepEqual(innovatorWhere(i), { id: 'inv1' })
  // Even with a different programme on the session, the record filter is the
  // innovator's own id, so there is no cross-tenant path.
  const j = ctx('innovator', 'programme-b')
  assert.deepEqual(innovatorWhere(j), { id: 'inv1' })
})

test('a mentor is scoped by their own mentor id, not by programme alone', () => {
  const m = ctx('mentor', 'programme-a')
  assert.deepEqual(bookingWhere(m), { mentorId: 'men1' })
  assert.deepEqual(innovatorWhere(m), { bookings: { some: { mentorId: 'men1' } } })
})
