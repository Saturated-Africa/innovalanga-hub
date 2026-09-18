/**
 * Which dashboard routes each role may open.
 *
 * Deliberately dependency-free — no NextAuth, no Next.js, no path aliases — so
 * the rules can be tested directly, the same way `scope-rules.ts` separates the
 * data-scoping rules from the code that resolves a session. `middleware.ts`
 * supplies the role and the path; this file decides where, if anywhere, the
 * request should be sent instead.
 *
 * This exists because the rules used to live inline in the middleware as a list
 * of `pathname.startsWith(prefix)` calls, and a plain prefix test is the wrong
 * comparison for a path. `/dashboard/innovator` is a prefix of
 * `/dashboard/innovators`, the facilitator-only participant list, so an
 * innovator requesting that page satisfied the innovator allowlist and passed
 * straight through with an HTTP 200 while every other restricted route returned
 * a 307. The page's own role guard still redirected, so nothing was served, but
 * the outer boundary was absent on exactly one route — and it was the one
 * listing every participant in the programme. Found independently by a code
 * audit and by QA against the deployed build.
 */

export type RouteRole =
  | 'super_admin'
  | 'facilitator'
  | 'mentor'
  | 'innovator'
  | 'funder_viewer'

/**
 * Prefix match that respects path segments.
 *
 * `inSection('/dashboard/innovators', '/dashboard/innovator')` is false, where
 * `String.startsWith` would return true. A section owns itself and anything
 * below it, and nothing else.
 */
export function inSection(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/')
}

/** Sections each restricted role may enter, plus where to send them if not. */
/** Reachable by every role, because it is only ever about the caller. */
const ALWAYS_ALLOWED = '/dashboard/account'

const ROLE_ACCESS: Record<
  Exclude<RouteRole, 'super_admin' | 'facilitator'>,
  { allowed: string[]; fallback: string }
> = {
  funder_viewer: {
    allowed: ['/dashboard/reports', '/dashboard/mande', '/dashboard/readiness'],
    fallback: '/dashboard/reports',
  },
  innovator: {
    allowed: ['/dashboard/innovator', '/dashboard/book'],
    fallback: '/dashboard/innovator/sessions',
  },
  mentor: {
    allowed: [
      '/dashboard/sessions',
      '/dashboard/mentor',
      '/dashboard/mentorship',
      '/dashboard/book/confirmed',
    ],
    fallback: '/dashboard/sessions',
  },
}

/**
 * Where this request should be redirected, or null to let it through.
 *
 * `/dashboard` itself is the role-aware landing page and is open to everyone
 * signed in; it redirects onward in the page component.
 */
export function redirectFor(pathname: string, role: string): string | null {
  // These rules describe the dashboard and nothing else. The middleware matcher
  // is currently narrow enough that no other path reaches here, but that is a
  // separate file: if the matcher were ever widened, public routes such as the
  // funder-facing /proof link would start redirecting to a sign-in page and the
  // evidence links in every exported workbook would break.
  if (!inSection(pathname, '/dashboard')) return null

  // Roles with an explicit allowlist are resolved first, so they land on their
  // own home rather than bouncing through `/dashboard` on the way. The admin
  // area appears in no allowlist, so it is already covered here.
  const rules = ROLE_ACCESS[role as keyof typeof ROLE_ACCESS]
  if (rules) {
    if (pathname === '/dashboard') return null
    // Everybody reaches their own account, whatever their role. It holds
    // nothing but the caller's own record, and a role that cannot change
    // its own password is stuck on whatever it was given.
    if (inSection(pathname, ALWAYS_ALLOWED)) return null
    if (rules.allowed.some((p) => inSection(pathname, p))) return null
    return rules.fallback
  }

  // Everyone else - facilitator, super_admin, and any role added later without
  // an allowlist - is unrestricted apart from the admin area.
  if (inSection(pathname, '/dashboard/admin') && role !== 'super_admin') {
    return '/dashboard'
  }

  return null
}
