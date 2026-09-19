import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

/**
 * Who is still allowed to use the connection that bypasses row-level security.
 *
 * Converting ninety-odd files to a tenant-scoped connection is the kind of
 * migration that stops at eighty percent and stays there, because nothing marks
 * the difference between a file that legitimately needs the owning connection
 * and one that simply has not been done yet. This draws that line.
 *
 * Two lists. SYSTEM is a decision: these run before a programme is known, or
 * deliberately across all of them, and each says why. PENDING is a backlog:
 * every entry is a file still reading through a connection that can see every
 * funder's data, protected only by the scope written in its own queries.
 *
 * The rule that makes this useful: a file may only import the shared client if
 * it appears on one of the two lists, and PENDING may only ever shrink. Adding
 * to it fails the test, so a new file cannot quietly join the backlog.
 */

const ROOTS = ['app', 'lib', 'components']
const SHARED_IMPORT = /from '@\/lib\/prisma'/

/** Files that need the owning connection, with the reason. */
const SYSTEM: Record<string, string> = {
  'app/api/admin/backfill/beneficiary-dob/route.ts':
    'A one-off platform maintenance job across every programme, restricted to super_admin. It derives a date of birth from an already-stored ID number and writes nothing else. A tenant connection would see one programme, which is the opposite of what a backfill needs.',
  'lib/auth.ts': 'Finds a user by email at sign-in, before any programme is known.',
  'lib/scope.ts': 'Works out which programme the caller is on. It cannot use a connection that needs the answer.',
  'lib/tenant-db.ts': 'Hands out the tenant connections. It holds the owning one by definition.',
  'lib/authz.ts':
    'Ownership and tenancy predicates. They are what decides which programme applies, so they run before one is fixed, and every one of them filters explicitly.',
  'app/api/auth/register/route.ts': 'Creates an account. There is no programme to scope to yet.',
  'app/api/health/route.ts': 'Liveness probe. Reads no rows about anybody.',
  'app/api/cron/auto-complete/route.ts': 'Sweeps bookings across every programme on a schedule.',
  'app/api/calendar/[mentorId]/route.ts': 'Calendar feed authenticated by a per-mentor token, with no session to resolve a programme from.',
  'app/api/calendar/[mentorId]/download/route.ts':
    'Downloads one event from that feed, authenticated by the same token and with no session behind it.',
  'app/proof/[token]/route.ts': 'Evidence link opened by a funder who has no account. The token is the credential.',
  'app/api/admin/users/route.ts': 'Platform-wide user administration. A super admin has no programme by definition.',
  'app/api/admin/users/[id]/route.ts':
    'Edits and removes accounts platform-wide, including administrators who belong to no programme.',
  'app/dashboard/admin/users/page.tsx':
    'Lists every account on the platform, which is what user administration is for.',

  // An account belongs to a person, not to a programme, and the person may be a
  // platform administrator with no programme at all. Both of these read only
  // the caller's own record, identified from the session.
  'app/api/account/password/route.ts':
    'Changes the caller’s own password. The account is not any programme’s property.',
  'app/dashboard/account/page.tsx':
    'Shows the caller their own account. Nothing here belongs to a tenant.',

  // Funds sit above programmes: one backs several, and a programme can be
  // co-funded, so a fund belongs to no single tenant. Fund administration is a
  // platform-level job like user administration. The tenant boundary is drawn
  // at the allocation, and everything a programme does with its share - the
  // grants, the tranches, the reported spend - is scoped normally.
  'app/api/funds/route.ts':
    'The fund register. A fund spans programmes and is administered by the fund manager.',
  'app/api/funds/[id]/route.ts':
    'Recording money received and earmarking it to programmes. Both act on the fund, which belongs to no one programme.',
  'app/dashboard/funds/page.tsx':
    'The fund register, showing capital across every programme it backs.',
  'app/dashboard/funds/[id]/page.tsx':
    'One fund across all the programmes it is allocated to, which no single tenant connection can see.',

  // These two read the grant through the tenant connection and only reach for
  // the owning one to ask the fund's position, which a programme-scoped
  // connection cannot answer. Without it the payment check cannot tell whether
  // the money is actually there.
  'app/api/grants/[id]/tranches/[trancheId]/route.ts':
    'The grant is read on the tenant connection; the fund balance behind the payment check is platform-level.',
  'app/dashboard/grants/[id]/page.tsx':
    'The grant is read on the tenant connection; the fund balance shown beside each tranche is platform-level.',
}

/**
 * Files not yet moved across. This list may only get shorter.
 *
 * Each is exactly as protected as it was before row-level security existed: by
 * the scope predicates in its own queries, which lib/authz.test.ts checks are
 * present. What it does not have is the database refusing on its behalf.
 */
const PENDING = new Set([
  'app/api/beneficiaries/[id]/route.ts',
  'app/api/bookings/[id]/cancel/route.ts',
  'app/api/bookings/route.ts',
  'app/api/innovator/me/route.ts',
  'app/api/ip/route.ts',
  'app/api/mentors/[id]/availability/route.ts',
  'app/api/mentors/[id]/event-types/route.ts',
  'app/api/mentors/me/route.ts',
  'app/api/notifications/route.ts',
  'app/api/programmes/[id]/periods/route.ts',
  'app/api/programmes/[id]/regions/route.ts',
  'app/dashboard/admin/page.tsx',
  'app/dashboard/admin/setup-innovator/[userId]/page.tsx',
  'app/dashboard/assessments/new/page.tsx',
  'app/dashboard/book/[mentorSlug]/page.tsx',
  'app/dashboard/book/confirmed/page.tsx',
  'app/dashboard/book/page.tsx',
  'app/dashboard/cohorts/[id]/page.tsx',
  'app/dashboard/innovator/sessions/page.tsx',
  'app/dashboard/innovators/[id]/page.tsx',
  'app/dashboard/layout.tsx',
  'app/dashboard/mande/page.tsx',
  'app/dashboard/mentor/availability/page.tsx',
  'app/dashboard/sessions/page.tsx',
  'components/shared/AuditLog.tsx',
  'lib/ai/pseudonymise.ts',
  'lib/ai/tools.ts',
  'lib/finance/persist-import.ts',
  'lib/notifications.ts',
])

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

async function usingSharedClient(): Promise<string[]> {
  const found: string[] = []
  for (const root of ROOTS) {
    for (const file of await walk(path.join(process.cwd(), root))) {
      const source = await readFile(file, 'utf8')
      if (SHARED_IMPORT.test(source)) {
        found.push(path.relative(process.cwd(), file).split(path.sep).join('/'))
      }
    }
  }
  return found.sort()
}

test('the source tree was actually scanned', async () => {
  const all = await walk(path.join(process.cwd(), 'app'))
  assert.ok(all.length > 50, `only found ${all.length} files under app/`)
})

test('nothing new joins the owning connection', async () => {
  const users = await usingSharedClient()
  const unaccounted = users.filter((f) => !(f in SYSTEM) && !PENDING.has(f))
  assert.deepEqual(
    unaccounted,
    [],
    'these files read through the connection that bypasses row-level security. ' +
      'Use tenantScope from lib/tenant-db, or add the file to SYSTEM with the reason it cannot: ' +
      unaccounted.join(', ')
  )
})

test('the backlog only shrinks', async () => {
  const users = new Set(await usingSharedClient())
  const done = [...PENDING].filter((f) => !users.has(f))
  assert.deepEqual(
    done,
    [],
    'these have been converted; delete them from PENDING so the list stays honest: ' + done.join(', ')
  )
})

test('every exemption names a file that exists', async () => {
  const users = new Set(await usingSharedClient())
  const stale = Object.keys(SYSTEM).filter((f) => !users.has(f))
  assert.deepEqual(stale, [], 'SYSTEM entries for files that no longer use it: ' + stale.join(', '))
})

test('every system exemption gives a reason', () => {
  const silent = Object.entries(SYSTEM).filter(([, why]) => why.trim().length < 20)
  assert.deepEqual(silent.map(([f]) => f), [], 'a bypass needs an argument, not a listing')
})
