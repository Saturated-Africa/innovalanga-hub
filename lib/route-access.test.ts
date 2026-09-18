import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inSection, redirectFor } from './route-access.ts'

/**
 * Regression tests for server-side route protection.
 *
 * The bug these exist for: `/dashboard/innovator` is a prefix of
 * `/dashboard/innovators`, so a `startsWith` allowlist let an innovator through
 * the middleware to the facilitator-only participant list. Every other
 * restricted route was correctly redirected, which is what made it hard to see.
 */

test('a section owns itself and its children, and nothing else', () => {
  assert.equal(inSection('/dashboard/innovator', '/dashboard/innovator'), true)
  assert.equal(inSection('/dashboard/innovator/ip', '/dashboard/innovator'), true)

  // The regression. A plain startsWith returns true here.
  assert.equal(inSection('/dashboard/innovators', '/dashboard/innovator'), false)
  assert.equal(inSection('/dashboard/innovators/abc', '/dashboard/innovator'), false)
})

test('an innovator cannot reach the participant list', () => {
  assert.equal(
    redirectFor('/dashboard/innovators', 'innovator'),
    '/dashboard/innovator/sessions'
  )
  assert.equal(
    redirectFor('/dashboard/innovators/some-id', 'innovator'),
    '/dashboard/innovator/sessions'
  )
})

test('an innovator keeps their own sections', () => {
  for (const path of [
    '/dashboard',
    '/dashboard/innovator',
    '/dashboard/innovator/sessions',
    '/dashboard/innovator/ip',
    '/dashboard/book',
    '/dashboard/book/confirmed',
  ]) {
    assert.equal(redirectFor(path, 'innovator'), null, path)
  }
})

test('an innovator is turned away from every other module', () => {
  for (const path of [
    '/dashboard/cohorts',
    '/dashboard/assessments',
    '/dashboard/stipends',
    '/dashboard/ip',
    '/dashboard/reports',
    '/dashboard/mande',
    '/dashboard/mentorship',
    '/dashboard/sessions',
    '/dashboard/admin',
  ]) {
    assert.equal(redirectFor(path, 'innovator'), '/dashboard/innovator/sessions', path)
  }
})

test('a mentor keeps their own sections and is turned away elsewhere', () => {
  for (const path of [
    '/dashboard',
    '/dashboard/sessions',
    '/dashboard/mentor/availability',
    '/dashboard/mentor/event-types',
    '/dashboard/mentorship',
    '/dashboard/book/confirmed',
  ]) {
    assert.equal(redirectFor(path, 'mentor'), null, path)
  }

  for (const path of ['/dashboard/innovators', '/dashboard/stipends', '/dashboard/admin']) {
    assert.equal(redirectFor(path, 'mentor'), '/dashboard/sessions', path)
  }

  // `/dashboard/book` is the innovator booking flow; only the shared
  // confirmation screen is a mentor's business.
  assert.equal(redirectFor('/dashboard/book', 'mentor'), '/dashboard/sessions')
})

test('a participant reaches their own grant, and staff pages stay closed', () => {
  // Linked in the innovator's sidebar, so the middleware has to let them in -
  // the same defect as the M&E menu item that was visible and bounced.
  assert.equal(redirectFor('/dashboard/innovator/grant', 'innovator'), null)

  // /dashboard/grants is the staff register of every award in the programme.
  // Its name is one character away from the participant's own page, which is
  // exactly the kind of near-miss the prefix bug was.
  assert.notEqual(redirectFor('/dashboard/grants', 'innovator'), null)
  assert.notEqual(redirectFor('/dashboard/funds', 'innovator'), null)
})

test('a funder reaches reports, M&E and the readiness trackers only', () => {
  assert.equal(redirectFor('/dashboard/reports', 'funder_viewer'), null)
  assert.equal(redirectFor('/dashboard/mande', 'funder_viewer'), null)
  assert.equal(redirectFor('/dashboard/mande/toc', 'funder_viewer'), null)

  // The tracker is linked in the funder's sidebar, so the middleware has to
  // let them in. A visible link the middleware bounces is the exact defect QA
  // reported against the M&E menu item.
  assert.equal(redirectFor('/dashboard/readiness/brl', 'funder_viewer'), null)
  assert.equal(redirectFor('/dashboard/readiness/trl', 'funder_viewer'), null)

  for (const path of [
    '/dashboard/innovators',
    '/dashboard/assessments',
    '/dashboard/stipends',
    '/dashboard/mentorship',
    '/dashboard/admin',
  ]) {
    assert.equal(redirectFor(path, 'funder_viewer'), '/dashboard/reports', path)
  }
})

test('the readiness tracker stays closed to innovators and mentors', () => {
  assert.equal(
    redirectFor('/dashboard/readiness/brl', 'innovator'),
    '/dashboard/innovator/sessions'
  )
  assert.equal(redirectFor('/dashboard/readiness/brl', 'mentor'), '/dashboard/sessions')
})

test('the public proof link is outside the dashboard entirely', () => {
  // A funder opening evidence from an exported workbook has no account. The
  // middleware matcher covers /dashboard only, so this path never reaches
  // these rules - asserted here so a future matcher change is deliberate.
  for (const role of ['innovator', 'mentor', 'funder_viewer', 'facilitator']) {
    assert.equal(redirectFor('/proof/abc123', role), null, role)
  }
  // Same for the other paths that must stay reachable without an account.
  assert.equal(redirectFor('/login', 'innovator'), null)
  assert.equal(redirectFor('/', 'funder_viewer'), null)
})

test('only a super_admin reaches the admin area', () => {
  assert.equal(redirectFor('/dashboard/admin', 'super_admin'), null)
  assert.equal(redirectFor('/dashboard/admin/users', 'super_admin'), null)

  assert.equal(redirectFor('/dashboard/admin', 'facilitator'), '/dashboard')
  assert.equal(redirectFor('/dashboard/admin/users', 'facilitator'), '/dashboard')
})

test('a facilitator moves freely outside the admin area', () => {
  for (const path of [
    '/dashboard',
    '/dashboard/innovators',
    '/dashboard/cohorts',
    '/dashboard/stipends',
    '/dashboard/reports',
  ]) {
    assert.equal(redirectFor(path, 'facilitator'), null, path)
  }
})

test('an unrecognised role is not silently granted access', () => {
  // No rules entry means no restriction here, so the role must never reach
  // middleware unrecognised. Documented so a future role addition is deliberate.
  assert.equal(redirectFor('/dashboard/admin', 'something_new'), '/dashboard')
})

test('every role can reach its own account page', () => {
  // A role that cannot change its own password is stuck on whatever it was
  // given, which for this platform means the password committed to the repo.
  for (const role of ['funder_viewer', 'innovator', 'mentor', 'facilitator', 'super_admin']) {
    assert.equal(
      redirectFor('/dashboard/account', role),
      null,
      `${role} should reach its own account`
    )
  }
})

test('the account page does not open up anything beside it', () => {
  // `inSection` is used rather than a prefix test, so a sibling route that
  // merely starts with the same characters is not swept in.
  assert.notEqual(redirectFor('/dashboard/accounts-payable', 'funder_viewer'), null)
})
