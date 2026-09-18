import { PrismaClient } from '@prisma/client'

/**
 * Database connections, and which one a piece of code is entitled to.
 *
 * There are two, and the difference between them is the whole point.
 *
 *   systemPrisma  connects as the owning role, which bypasses row-level
 *                 security. A small number of operations genuinely need this:
 *                 finding a user by email at sign-in, before any programme is
 *                 known; the scheduled job that sweeps every programme's
 *                 bookings; platform-wide user administration. Reaching for it
 *                 anywhere else gives up the protection entirely.
 *
 *   tenantPrisma  connects as a role that owns nothing and cannot bypass
 *                 anything, with the caller's programme fixed on the
 *                 connection. Postgres filters every query against it. This is
 *                 what serves programme data.
 *
 * The programme travels on the connection string rather than being set per
 * query. That was a deliberate choice and it was tested before it was built:
 * wrapping every query in a transaction to set a session variable is the
 * approach Prisma's own documentation marks as not for production, and it adds
 * a round trip to every read. A connection carrying `options=-c
 * app.programme_id=...` arrives with the value already set, which means one
 * pool per programme and nothing to remember at the call site.
 *
 * The cost of that choice is a connection pool per programme. Pools are small
 * and created on first use, and a platform with enough funders for that to
 * matter has bigger things to tune.
 */

const globalForPrisma = globalThis as unknown as {
  systemPrisma?: PrismaClient
  tenantClients?: Map<string, PrismaClient>
}

const log: ('query' | 'error' | 'warn')[] =
  process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error']

/**
 * The owning connection. Bypasses row-level security.
 *
 * Exported under a name that cannot be reached for absent-mindedly. Anything
 * that serves a programme's data should be using `tenantPrisma`.
 */
export const systemPrisma =
  globalForPrisma.systemPrisma ?? new PrismaClient({ log })

if (process.env.NODE_ENV !== 'production') globalForPrisma.systemPrisma = systemPrisma

/**
 * The default export, for now the owning connection.
 *
 * Ninety-seven files import this. They are being moved over to `tenantPrisma`
 * a module at a time rather than in one sweep, because getting it wrong in one
 * direction breaks the platform and in the other serves one funder's data to
 * another. Until a module is moved it is exactly as protected as it was before
 * row-level security existed: by the scope predicates in its route, which are
 * checked by lib/authz.test.ts.
 */
export const prisma = systemPrisma

/**
 * Put a programme onto a connection string.
 *
 * `options` passes backend command-line options, and `-c name=value` sets a
 * configuration parameter for every session on that connection. The value is
 * encoded because the whole option string is one query parameter, and a space
 * or an equals sign inside it would be read as the start of another option -
 * a connection that is rejected outright, which is at least loud.
 */
export function connectionStringFor(baseUrl: string, programmeId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(programmeId)) {
    // Identifiers are cuids. Anything else did not come from the database, and
    // injecting it into backend startup options is not a risk worth taking for
    // an input that cannot legitimately occur.
    throw new Error('Refusing to build a connection for a malformed programme id.')
  }

  const url = new URL(baseUrl)
  url.searchParams.set('options', `-c app.programme_id=${programmeId}`)
  // A pool per programme, so several tenants cannot together exhaust the
  // database's connection limit.
  if (!url.searchParams.has('connection_limit')) {
    url.searchParams.set('connection_limit', '5')
  }
  return url.toString()
}

/** Base URL for the restricted role. Falls back so a half-configured environment fails loudly, not silently. */
function appDatabaseUrl(): string {
  const url = process.env.APP_DATABASE_URL
  if (!url) {
    throw new Error(
      'APP_DATABASE_URL is not set. Row-level security needs the restricted role; ' +
        'refusing to serve programme data over the owning connection, which bypasses it.'
    )
  }
  return url
}

/**
 * Has this connection been proved to be filtered?
 *
 * Checked once per client, then remembered. The check is not about data - with
 * a single programme on the platform, a filtered connection and an unfiltered
 * one return the same counts, which is precisely how a broken policy would go
 * unnoticed. It asks the two questions that actually decide it: can this role
 * bypass row-level security, and does it own the tables it is reading. A table
 * owner is not subject to its own policies, so ownership alone is enough to
 * make every policy on the platform decorative.
 *
 * This is what `FORCE ROW LEVEL SECURITY` would otherwise have caught. FORCE is
 * not used here because it would also apply to the owning connection, which has
 * to find a user by email before any programme is known; sign-in would fail for
 * everybody. A check that refuses to serve is a better trade than a setting
 * that silently breaks authentication.
 */
const proved = new WeakSet<PrismaClient>()

async function assertFiltered(client: PrismaClient, programmeId: string): Promise<void> {
  if (proved.has(client)) return

  const rows = await client.$queryRaw<
    { role: string; bypasses: boolean; owns: boolean; programme: string | null }[]
  >`
    SELECT current_user::text                              AS role,
           COALESCE(r.rolbypassrls, false)                  AS bypasses,
           EXISTS (
             SELECT 1 FROM pg_tables t
             WHERE t.schemaname = 'public' AND t.tableowner = current_user
           )                                                AS owns,
           current_setting('app.programme_id', true)        AS programme
    FROM pg_roles r WHERE r.rolname = current_user
  `

  const row = rows[0]
  if (!row) throw new Error('Could not establish who the database connection is.')

  const problems: string[] = []
  if (row.bypasses) problems.push(`the role ${row.role} can bypass row-level security`)
  if (row.owns) problems.push(`the role ${row.role} owns tables, so its policies do not apply to it`)
  if (row.programme !== programmeId) {
    problems.push(`the connection reports programme ${row.programme ?? 'none'}, expected ${programmeId}`)
  }

  if (problems.length > 0) {
    throw new Error(
      `Refusing to serve programme data: ${problems.join('; ')}. ` +
        `Row-level security would not be enforcing on this connection.`
    )
  }

  proved.add(client)
}

/**
 * A connection that can only see one programme's rows.
 *
 * The first call for a given programme opens the pool and proves the connection
 * is filtered before handing it back. Every call after that is a map lookup.
 */
export async function tenantPrisma(programmeId: string): Promise<PrismaClient> {
  const clients = (globalForPrisma.tenantClients ??= new Map<string, PrismaClient>())

  let client = clients.get(programmeId)
  if (!client) {
    client = new PrismaClient({
      log,
      datasources: { db: { url: connectionStringFor(appDatabaseUrl(), programmeId) } },
    })
    clients.set(programmeId, client)
  }

  await assertFiltered(client, programmeId)
  return client
}

/** Whether the restricted role is configured at all. */
export function tenantConnectionAvailable(): boolean {
  return Boolean(process.env.APP_DATABASE_URL)
}
