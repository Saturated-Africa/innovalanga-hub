import { NextAuthOptions, getServerSession } from 'next-auth'
import { sessionCookieName } from '@/lib/session-cookie'
import CredentialsProvider from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@next-auth/prisma-adapter'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { UserRole } from '@prisma/client'
import {
  checkRateLimit,
  clearRateLimit,
  clientIp,
  LOGIN_PER_IP,
  LOGIN_PER_ACCOUNT,
} from '@/lib/rate-limit'

/**
 * A real bcrypt hash of a value nobody holds, compared against when the email
 * is unknown so that the failure path costs the same as the success path.
 * Generated once at module load rather than hard-coded, so it carries no
 * meaningful secret.
 */
const DUMMY_HASH = bcrypt.hashSync('unused-placeholder-for-timing-parity', 12)

export type { UserRole }

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
      role: UserRole
      programmeId?: string | null
    }
  }
  interface User {
    role: UserRole
    programmeId?: string | null
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role: UserRole
    id: string
    programmeId?: string | null
  }
}

/**
 * Cookie security follows the scheme the app is actually served over, not the
 * build mode.
 *
 * Keying this off NODE_ENV was wrong: the sandbox runs a production build over
 * plain HTTP, and a `Secure` cookie with a `__Host-` prefix is rejected outright
 * by the browser on HTTP - so hardening the cookie would have silently broken
 * sign-in there while looking correct in the source.
 *
 * `__Host-` is the strictest prefix available: the browser accepts it only over
 * HTTPS, with Path=/ and no Domain, which stops a sibling subdomain from
 * setting a session cookie for the parent.
 */
const isSecureDeployment = (process.env.NEXTAUTH_URL ?? '').startsWith('https://')

const cookieName = sessionCookieName(process.env.NEXTAUTH_URL)

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  session: {
    strategy: 'jwt',
    // Was the NextAuth default of 30 days. Sessions cannot be revoked under the
    // JWT strategy - deleting a user leaves their token valid until it expires -
    // so the expiry is the only control there is, and 30 days is too long for a
    // platform holding participant records.
    maxAge: 8 * 60 * 60, // 8 hours
    updateAge: 60 * 60, // refresh at most hourly while in use
  },
  // No cookie configuration existed at all, so everything here was implicit.
  cookies: {
    sessionToken: {
      name: cookieName,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: isSecureDeployment,
      },
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null

        const email = credentials.email.trim().toLowerCase()
        const ip = clientIp(new Headers((req?.headers ?? {}) as Record<string, string>))

        // Two independent limits: one host spraying many accounts, and many
        // hosts targeting one account. There was no limit of any kind before.
        const ipCheck = checkRateLimit(`login:ip:${ip}`, LOGIN_PER_IP)
        const accountCheck = checkRateLimit(`login:acct:${email}`, LOGIN_PER_ACCOUNT)
        if (!ipCheck.allowed || !accountCheck.allowed) {
          throw new Error('TooManyAttempts')
        }

        const user = await prisma.user.findUnique({ where: { email } })

        // An unknown email used to return before bcrypt ever ran, while a known
        // one paid for a cost-12 hash. That is roughly a hundredfold difference
        // in response time and it reads as an account enumeration oracle over
        // the network. Comparing against a fixed dummy hash keeps both paths on
        // the same order of magnitude.
        if (!user || !user.password) {
          await bcrypt.compare(credentials.password, DUMMY_HASH)
          return null
        }

        const isValid = await bcrypt.compare(credentials.password, user.password)
        if (!isValid) return null

        // Only a real sign-in clears the counters.
        clearRateLimit(`login:ip:${ip}`)
        clearRateLimit(`login:acct:${email}`)

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          programmeId: user.programmeId ?? null,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role
        token.id = user.id
        token.programmeId = user.programmeId ?? null
      }
      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id
        session.user.role = token.role
        session.user.programmeId = token.programmeId ?? null
      }
      return session
    },
  },
}

export async function getSession() {
  return await getServerSession(authOptions)
}

export async function requireAuth(allowedRoles?: UserRole[]) {
  const session = await getSession()
  if (!session) return null
  if (allowedRoles && !allowedRoles.includes(session.user.role)) return null
  return session
}

/** Role hierarchy for menu visibility */
export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  facilitator: 'Facilitator',
  mentor: 'Mentor',
  innovator: 'Innovator',
  funder_viewer: 'Funder Viewer',
}

export function canAccess(userRole: UserRole, allowedRoles: UserRole[]): boolean {
  return allowedRoles.includes(userRole)
}
