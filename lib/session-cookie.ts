/**
 * The name of the session cookie, in one place.
 *
 * Two things have to agree on this and they run in different places: the
 * NextAuth configuration sets the cookie in the Node runtime, and the
 * middleware reads it in the Edge runtime, where it cannot import anything that
 * touches the database. When they disagreed, the result was a platform that
 * authenticated correctly and then refused every page: the callback issued a
 * valid session, the middleware looked for a cookie under a different name,
 * found nothing, and redirected to sign in. Signing in again produced the same
 * loop, and nothing in the logs said why.
 *
 * Deliberately dependency-free for that reason, like lib/route-access.ts.
 *
 * On the prefix: `__Host-` is stronger than `__Secure-`. It additionally
 * forbids a Domain attribute and requires Path=/, which means a sibling
 * subdomain cannot set a session cookie the parent would accept. That matters
 * here, because this application is on a subdomain and the apex hosts an
 * unrelated site elsewhere. NextAuth's own default when secure is `__Secure-`,
 * so the middleware has to be told the name explicitly rather than guessing it.
 */
export const SECURE_SESSION_COOKIE = '__Host-next-auth.session-token'
export const INSECURE_SESSION_COOKIE = 'next-auth.session-token'

/**
 * Which cookie name applies for a given deployment URL.
 *
 * Derived from the scheme of NEXTAUTH_URL rather than from NODE_ENV. A sandbox
 * served over plain http is still NODE_ENV=production, and keying the cookie's
 * security off the wrong thing would have made sign-in impossible there.
 */
export function sessionCookieName(nextAuthUrl: string | undefined): string {
  return (nextAuthUrl ?? '').startsWith('https://')
    ? SECURE_SESSION_COOKIE
    : INSECURE_SESSION_COOKIE
}
