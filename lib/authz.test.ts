import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

/**
 * Every API route, checked for the three things each one needs.
 *
 * This exists because of how the authorisation bugs got in. None of them was a
 * check written wrongly; they were checks nobody wrote. A route was added, it
 * worked, it was reviewed by someone reading the feature rather than the
 * boundary, and it shipped reading rows from every programme on the platform.
 * Nine of them accumulated that way.
 *
 * So this does not test behaviour - the scope rules have their own tests. It
 * reads the source of every route and fails when one lacks a session check, a
 * role gate, or a scope predicate. It is a structural check, and a coarse one:
 * it cannot tell a correct scope from an incorrect one. What it can do is make
 * a missing one impossible to add silently, which is the failure that actually
 * happened.
 *
 * Anything that genuinely needs no check is listed below with the reason. That
 * list is the point: an exemption has to be argued for in writing, once, rather
 * than assumed route by route.
 */

const API_DIR = path.join(process.cwd(), 'app/api')

/** Routes that legitimately run without a session, and why. */
const PUBLIC_ROUTES: Record<string, string> = {
  'auth/[...nextauth]': 'NextAuth’s own handler. It is the thing that creates sessions.',
  'auth/register': 'Public registration. Rate limited and honeypotted rather than authenticated.',
  health: 'Liveness probe for the load balancer. Returns no data about anybody.',
  'cron/auto-complete': 'Called by the scheduler, authenticated by a shared secret rather than a session.',
  'calendar/[mentorId]': 'iCal feed read by calendar clients that cannot hold a session. Authenticated by an unguessable per-mentor token.',
  'proof/[token]': 'Evidence link handed to a funder who has no account. The token is the credential.',
}

/** Routes that need a session but no role gate, and why. */
const NO_ROLE_GATE: Record<string, string> = {
  'account/password':
    'Every role changes their own password. The gate is the current password, not the role.',
  'programmes/me': 'Returns which programme the caller is on. Every role needs it and it discloses nothing else.',
  'innovator/me': 'Returns the caller’s own profile. The session is the scope.',
  'mentors/me': 'Returns the caller’s own profile. The session is the scope.',
  notifications: 'Reads and marks the caller’s own notifications. The session is the scope.',
  assistant: 'Every role may ask; what the assistant can reach is decided per role in lib/ai/scope-rules.',
  'mentors/[id]/availability': 'Ownership is the gate here, not role: a mentor owns their calendar and an administrator reaches it through the shared predicate.',
  'mentors/[id]/event-types': 'Ownership is the gate here, not role.',
  'programmes/[id]/periods': 'Programme configuration, scoped by the programme in the path.',
  'programmes/[id]/regions': 'Programme configuration, scoped by the programme in the path.',
}

/** Routes whose scope is the caller's own identity rather than a programme. */
const SELF_SCOPED: Record<string, string> = {
  'account/password':
    'Keyed on the caller’s own user id, taken from the session. There is no id in the route, so it cannot be pointed at anybody else.',
  'innovator/me': 'Keyed on the caller’s user id.',
  'mentors/me': 'Keyed on the caller’s user id.',
  notifications: 'Keyed on the caller’s user id.',
  assistant: 'Scoped inside lib/ai/scope.ts, which resolves the caller’s context server-side.',
  'admin/users/[id]':
    'Accounts are administered platform-wide by a super_admin, who by definition has no programme. Scoping this to one programme would make the role unable to do its job.',
  funds:
    'A fund spans programmes: one backs several and a programme can be co-funded, so a fund belongs to no single tenant. Restricted to the fund manager, and the tenant boundary is drawn at the allocation.',
  'funds/[id]':
    'Recording money received and allocating it act on the fund itself. The programme named when allocating is checked through assertProgrammeInScope.',
}

const SESSION_PATTERN = /getSession\(\)/

/**
 * A role gate, written inline or delegated.
 *
 * The predicates in lib/authz take the session and decide by role inside
 * themselves, so a route that calls one has a role gate even though the words
 * `session.user.role` never appear in it. Counting only the inline form would
 * push routes back towards hand-written checks, which is the opposite of what
 * this is for.
 */
const ROLE_PATTERN =
  /session\.user\.role|canActAsMentor|canActOnBooking|canManageMentorSchedule|canReadMentorSchedule|canRead|canEdit|canSign|canApprove|canReturn/
const SCOPE_PATTERN =
  /tenantScope|resolveProgrammeId|assertProgrammeInScope|getScopedContext|innovatorWhere|bookingWhere|assessmentWhere|programmeWhere|canActAsMentor|canActOnBooking|canAccessDocument|innovatorInProgramme|mentorInProgramme|canManageMentorSchedule|canReadMentorSchedule|indicatorInProgramme|stipendRecordInProgramme|callerMentorId|userId: session\.user\.id/

async function findRoutes(dir: string, prefix = ''): Promise<{ id: string; file: string }[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const routes: { id: string; file: string }[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      routes.push(...(await findRoutes(full, prefix ? `${prefix}/${entry.name}` : entry.name)))
    } else if (entry.name === 'route.ts') {
      routes.push({ id: prefix, file: full })
    }
  }
  return routes
}

/**
 * Loaded once and shared. Discovered lazily rather than at module scope because
 * the test runner compiles to CommonJS, where a top-level await is a syntax
 * error rather than a slow start.
 */
let cached: { id: string; file: string }[] | null = null
async function allRoutes() {
  if (!cached) cached = await findRoutes(API_DIR)
  return cached
}

test('the API surface was found at all', async () => {
  const routes = await allRoutes()
  // A glob that matches nothing would make every test below pass silently,
  // which is how ten tests in this repo went a month without running.
  assert.ok(routes.length > 40, `only found ${routes.length} routes`)
})

test('every route checks for a session, or is listed as public', async () => {
  const routes = await allRoutes()
  const missing: string[] = []
  for (const route of routes) {
    if (route.id in PUBLIC_ROUTES) continue
    const source = await readFile(route.file, 'utf8')
    if (!SESSION_PATTERN.test(source)) missing.push(route.id)
  }
  assert.deepEqual(
    missing,
    [],
    `these routes never call getSession(). Add the check, or add the route to PUBLIC_ROUTES with a reason: ${missing.join(', ')}`
  )
})

test('every route gates on a role, or is listed as not needing one', async () => {
  const routes = await allRoutes()
  const missing: string[] = []
  for (const route of routes) {
    if (route.id in PUBLIC_ROUTES || route.id in NO_ROLE_GATE) continue
    const source = await readFile(route.file, 'utf8')
    if (!ROLE_PATTERN.test(source)) missing.push(route.id)
  }
  assert.deepEqual(
    missing,
    [],
    `these routes never look at the caller's role. Add the gate, or add the route to NO_ROLE_GATE with a reason: ${missing.join(', ')}`
  )
})

test('every route scopes its rows, or is listed as self-scoped or public', async () => {
  const routes = await allRoutes()
  const missing: string[] = []
  for (const route of routes) {
    if (route.id in PUBLIC_ROUTES || route.id in SELF_SCOPED) continue
    const source = await readFile(route.file, 'utf8')
    if (!SCOPE_PATTERN.test(source)) missing.push(route.id)
  }
  assert.deepEqual(
    missing,
    [],
    `these routes read or write rows without scoping them to the caller. Use a predicate from lib/scope or lib/authz, or add the route to SELF_SCOPED with a reason: ${missing.join(', ')}`
  )
})

test('no route takes a programme id from the request', async () => {
  // Every M&E route once did exactly this, which let any signed-in facilitator
  // or funder read another programme's data by editing the query string.
  const routes = await allRoutes()
  const offenders: string[] = []
  for (const route of routes) {
    const source = await readFile(route.file, 'utf8')
    if (/searchParams\.get\(['"]programmeId['"]\)/.test(source)) offenders.push(route.id)
    if (/programmeId:\s*(body|parsed\.data)\.programmeId/.test(source)) offenders.push(route.id)
  }
  assert.deepEqual(offenders, [], `programmeId must come from the session: ${offenders.join(', ')}`)
})

test('every exemption names a route that exists', async () => {
  const routes = await allRoutes()
  const ids = new Set(routes.map((r) => r.id))
  const stale = [
    ...Object.keys(PUBLIC_ROUTES),
    ...Object.keys(NO_ROLE_GATE),
    ...Object.keys(SELF_SCOPED),
  ].filter((id) => !ids.has(id) && id !== 'proof/[token]')

  assert.deepEqual(
    stale,
    [],
    `these exemptions are for routes that no longer exist and should be deleted: ${stale.join(', ')}`
  )
})
