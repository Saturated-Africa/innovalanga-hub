import { test } from 'node:test'
import assert from 'node:assert/strict'
import { homeRouteFor, LOGIN_ROUTE } from './home-route.ts'

/**
 * The entry splash and the dashboard both send a signed-in user somewhere.
 * These were separate literals in two files; this table is what stops them
 * drifting apart when a role is added.
 */

test('each role lands on its own home', () => {
  assert.equal(homeRouteFor('innovator'), '/dashboard/innovator/sessions')
  assert.equal(homeRouteFor('mentor'), '/dashboard/sessions')
  assert.equal(homeRouteFor('funder_viewer'), '/dashboard/reports')
  assert.equal(homeRouteFor('facilitator'), '/dashboard')
  assert.equal(homeRouteFor('super_admin'), '/dashboard')
})

test('no session goes to sign in, not to a dashboard', () => {
  assert.equal(homeRouteFor(null), LOGIN_ROUTE)
  assert.equal(homeRouteFor(undefined), LOGIN_ROUTE)
  assert.equal(homeRouteFor(''), LOGIN_ROUTE)
})

test('an unknown role falls back to a guarded route', () => {
  // /dashboard runs its own session and role checks, so an unrecognised value
  // cannot be used to land somewhere that trusts the caller.
  assert.equal(homeRouteFor('something_new'), '/dashboard')
})

test('every destination is a local path, never an external URL', () => {
  for (const role of [
    'innovator',
    'mentor',
    'funder_viewer',
    'facilitator',
    'super_admin',
    'unknown',
    null,
  ]) {
    const route = homeRouteFor(role)
    assert.ok(route.startsWith('/'), `${role} -> ${route}`)
    // A destination beginning `//` is protocol-relative and leaves the site.
    assert.ok(!route.startsWith('//'), `${role} -> ${route} is protocol-relative`)
  }
})
