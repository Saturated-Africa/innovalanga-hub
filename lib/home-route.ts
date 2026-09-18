/**
 * Where each role belongs when they enter the platform.
 *
 * Dependency-free and shared, so the splash screen and the dashboard's own
 * role redirect cannot drift apart. They were separate literals before, which
 * is the kind of duplication that quietly sends one role to the wrong place
 * after somebody adds a fourth.
 */

export const LOGIN_ROUTE = '/login'

const HOME_BY_ROLE: Record<string, string> = {
  innovator: '/dashboard/innovator/sessions',
  mentor: '/dashboard/sessions',
  funder_viewer: '/dashboard/reports',
  facilitator: '/dashboard',
  super_admin: '/dashboard',
}

/**
 * The first page this role should see.
 *
 * An unknown or absent role falls back to `/dashboard`, which carries its own
 * session and role checks, so an unrecognised value cannot be used to land
 * somewhere unguarded.
 */
export function homeRouteFor(role: string | null | undefined): string {
  if (!role) return LOGIN_ROUTE
  return HOME_BY_ROLE[role] ?? '/dashboard'
}
