import type { PrismaClient } from '@prisma/client'
import type { Session } from 'next-auth'
import { resolveProgrammeId } from '@/lib/scope'
import { systemPrisma, tenantPrisma, tenantConnectionAvailable } from '@/lib/prisma'

/**
 * The caller's programme, and a connection that can only see it.
 *
 * Two things that were always used together and are now handed out together.
 * Every route already resolved a programme and then queried through a
 * connection that could see all of them; the scope in the `where` clause was
 * the only thing keeping one funder's data away from another. This returns a
 * connection where that separation is the database's job as well.
 *
 * Returns null when the caller has no programme, which routes already handle -
 * it is the same condition as `resolveProgrammeId` returning null. Returning
 * null rather than an unscoped connection means a missing programme cannot
 * quietly become access to every programme.
 *
 * Usage, at the top of a route or page:
 *
 *     const scope = await tenantScope(session)
 *     if (!scope) return NextResponse.json({ error: 'No programme found' }, { status: 404 })
 *     const { programmeId, db: prisma } = scope
 *
 * Binding it to the name `prisma` is deliberate. The queries beneath it do not
 * change, which keeps the diff of each conversion to its first few lines and
 * makes it obvious when one has been missed: a file still importing the shared
 * client has not been converted.
 */
export interface TenantScope {
  programmeId: string
  db: PrismaClient
}

let warned = false

export async function tenantScope(session: Session): Promise<TenantScope | null> {
  const programmeId = await resolveProgrammeId(session)
  if (!programmeId) return null

  if (!tenantConnectionAvailable()) {
    // A deployment must never fall back to the connection that bypasses
    // row-level security. A developer's machine, before the migration has run,
    // reasonably has no restricted role yet - so it falls back loudly rather
    // than refusing to start.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'APP_DATABASE_URL is not set. Refusing to serve programme data over the ' +
          'owning connection, which bypasses row-level security.'
      )
    }
    if (!warned) {
      warned = true
      console.warn(
        '[tenant-db] APP_DATABASE_URL is not set; falling back to the owning ' +
          'connection. Row-level security is NOT enforcing in this process.'
      )
    }
    return { programmeId, db: systemPrisma }
  }

  return { programmeId, db: await tenantPrisma(programmeId) }
}

/**
 * A connection for a programme the caller has already been cleared to act on.
 *
 * Some routes legitimately take a programme from the request - a super admin
 * switching between funders - and check it with `assertProgrammeInScope` rather
 * than reading it from the session. Those need a connection for the programme
 * that was approved, not for the caller's default one.
 *
 * The id must come from `assertProgrammeInScope`. Passing a value straight from
 * a request body would make this the hole that row-level security exists to
 * close.
 */
export async function tenantScopeFor(programmeId: string): Promise<PrismaClient> {
  if (!tenantConnectionAvailable()) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'APP_DATABASE_URL is not set. Refusing to serve programme data over the ' +
          'owning connection, which bypasses row-level security.'
      )
    }
    return systemPrisma
  }
  return tenantPrisma(programmeId)
}
