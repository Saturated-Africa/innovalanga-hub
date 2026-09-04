/**
 * Seeded accounts from prisma/seed.ts.
 *
 * These are the fixture identities the whole suite is built on. They exist only
 * in seeded environments; pointing the suite at an environment without the seed
 * will fail at sign-in rather than silently passing.
 */
export const ACCOUNTS = {
  superAdmin: { email: 'admin@innovalanga.co.za', password: 'Admin@1234', role: 'super_admin' },
  facilitator: {
    email: 'facilitator@innovalanga.co.za',
    password: 'Facilitator@1234',
    role: 'facilitator',
  },
  mentor: { email: 'mentor1@innovalanga.co.za', password: 'Mentor@1234', role: 'mentor' },
  innovator: { email: 'zanele@innovalanga.co.za', password: 'Innovator@1234', role: 'innovator' },
  funder: { email: 'funder@tia.gov.za', password: 'Funder@1234', role: 'funder_viewer' },
} as const

export type AccountKey = keyof typeof ACCOUNTS

/** Where each role lands after signing in, per the middleware redirects. */
export const LANDING: Record<AccountKey, RegExp> = {
  superAdmin: /\/dashboard$/,
  facilitator: /\/dashboard$/,
  mentor: /\/dashboard\/sessions/,
  innovator: /\/dashboard\/innovator\/sessions/,
  funder: /\/dashboard\/reports/,
}
