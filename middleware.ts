import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token
    const pathname = req.nextUrl.pathname

    if (!token) {
      return NextResponse.redirect(new URL('/login', req.url))
    }

    const role = token.role as string

    // Only super_admin can access the admin panel
    if (pathname.startsWith('/dashboard/admin') && role !== 'super_admin') {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }

    // Funder viewer can only access reports and M&E
    if (role === 'funder_viewer') {
      const allowed = ['/dashboard/reports', '/dashboard/mande']
      const isAllowed = allowed.some((p) => pathname.startsWith(p))
      if (!isAllowed) {
        return NextResponse.redirect(new URL('/dashboard/reports', req.url))
      }
    }

    // Innovators can only access their own sections
    if (role === 'innovator') {
      const allowed = ['/dashboard/innovator', '/dashboard/book']
      const isAllowed = allowed.some((p) => pathname.startsWith(p)) || pathname === '/dashboard' || pathname === '/dashboard/book/confirmed' || pathname.startsWith('/dashboard/innovator/ip')
      if (!isAllowed) {
        return NextResponse.redirect(new URL('/dashboard/innovator/sessions', req.url))
      }
    }

    // Mentors can only access mentor-relevant sections
    if (role === 'mentor') {
      const allowed = ['/dashboard/sessions', '/dashboard/mentor', '/dashboard/mentorship', '/dashboard/book/confirmed']
      const isAllowed = allowed.some((p) => pathname.startsWith(p)) || pathname === '/dashboard'
      if (!isAllowed) {
        return NextResponse.redirect(new URL('/dashboard/sessions', req.url))
      }
    }

    return NextResponse.next()
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
)

export const config = {
  matcher: ['/dashboard/:path*'],
}
