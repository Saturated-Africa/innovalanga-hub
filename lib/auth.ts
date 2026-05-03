import { NextAuthOptions, getServerSession } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@next-auth/prisma-adapter'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { UserRole } from '@prisma/client'

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

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  session: { strategy: 'jwt' },
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
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        })

        if (!user || !user.password) return null

        const isValid = await bcrypt.compare(credentials.password, user.password)
        if (!isValid) return null

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
