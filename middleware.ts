import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'
import { redirectFor } from '@/lib/route-access'
import { sessionCookieName } from '@/lib/session-cookie'

/**
 * Server-side route protection.
 *
 * The rules live in `lib/route-access.ts` so they can be tested without
 * standing up NextAuth or Next.js. See that file for why a plain
 * `startsWith` prefix test was the wrong comparison.
 */
export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token
    if (!token) {
      return NextResponse.redirect(new URL('/login', req.url))
    }

    const destination = redirectFor(req.nextUrl.pathname, token.role as string)
    if (destination) {
      return NextResponse.redirect(new URL(destination, req.url))
    }

    return NextResponse.next()
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
    /*
     * The cookie is named explicitly, not left to be guessed.
     *
     * NextAuth's own default for a secure deployment is the `__Secure-` prefix,
     * and this application uses the stronger `__Host-` one. Without this line
     * the middleware looks for a cookie that is never set: sign-in succeeds,
     * every page then redirects back to sign-in, and signing in again does the
     * same thing. Nothing in the logs says why, because nothing has failed.
     */
    cookies: {
      sessionToken: { name: sessionCookieName(process.env.NEXTAUTH_URL) },
    },
  }
)

export const config = {
  matcher: ['/dashboard/:path*'],
}
