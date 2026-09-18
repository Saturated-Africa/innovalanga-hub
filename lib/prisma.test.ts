import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connectionStringFor } from './prisma'

/**
 * The connection string is where the tenant boundary is actually set.
 *
 * Everything downstream trusts that `app.programme_id` arrived on the
 * connection. If this function builds the option wrongly the database either
 * refuses the connection, which is loud and fine, or silently starts a session
 * with no programme - which under these policies reads as an empty database,
 * and would be diagnosed as anything but a malformed URL.
 */

const BASE = 'postgresql://innovalanga_app:secret@localhost:5432/innovalanga'

test('the programme is set as a backend option', () => {
  const url = new URL(connectionStringFor(BASE, 'cmabc123'))
  assert.equal(url.searchParams.get('options'), '-c app.programme_id=cmabc123')
})

test('the rest of the connection is left alone', () => {
  const url = new URL(connectionStringFor(BASE, 'cmabc123'))
  assert.equal(url.username, 'innovalanga_app')
  assert.equal(url.hostname, 'localhost')
  assert.equal(url.port, '5432')
  assert.equal(url.pathname, '/innovalanga')
})

test('a pool bound is applied so tenants cannot exhaust the database', () => {
  const url = new URL(connectionStringFor(BASE, 'cmabc123'))
  assert.equal(url.searchParams.get('connection_limit'), '5')
})

test('an existing pool bound is respected rather than overwritten', () => {
  const url = new URL(connectionStringFor(`${BASE}?connection_limit=2`, 'cmabc123'))
  assert.equal(url.searchParams.get('connection_limit'), '2')
})

test('existing parameters survive', () => {
  const url = new URL(connectionStringFor(`${BASE}?schema=public&sslmode=prefer`, 'cmabc123'))
  assert.equal(url.searchParams.get('schema'), 'public')
  assert.equal(url.searchParams.get('sslmode'), 'prefer')
  assert.equal(url.searchParams.get('options'), '-c app.programme_id=cmabc123')
})

test('a programme id already present is replaced, not appended twice', () => {
  const once = connectionStringFor(BASE, 'cmabc123')
  const twice = connectionStringFor(once, 'cmxyz789')
  const url = new URL(twice)
  assert.equal(url.searchParams.getAll('options').length, 1)
  assert.equal(url.searchParams.get('options'), '-c app.programme_id=cmxyz789')
})

test('the option is encoded, so the space cannot start a second option', () => {
  const raw = connectionStringFor(BASE, 'cmabc123')
  assert.ok(!/options=-c app\./.test(raw), 'the space must not survive unencoded')
  assert.match(raw, /options=-c(\+|%20)app\.programme_id%3Dcmabc123/)
})

for (const bad of [
  'cm abc',
  'cm;DROP',
  "cm'--",
  '-c log_statement=all',
  'cm=1 -c x=y',
  '',
]) {
  test(`a malformed programme id is refused: ${JSON.stringify(bad)}`, () => {
    assert.throws(() => connectionStringFor(BASE, bad), /malformed programme id/)
  })
}

test('ordinary cuids are accepted', () => {
  for (const id of ['cmtnd9w980000vfngj1dfwm79', 'abc-123_XYZ']) {
    assert.doesNotThrow(() => connectionStringFor(BASE, id))
  }
})
