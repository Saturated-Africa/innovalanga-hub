/**
 * Seeded accounts from prisma/seed.ts.
 *
 * These are the fixture identities the whole suite is built on. They exist only
 * in seeded environments; pointing the suite at an environment without the seed
 * will fail at sign-in rather than silently passing.
 *
 * Any password can be overridden from the environment, because a deployed
 * environment's passwords drift from the seed the moment somebody changes one -
 * and then the suite fails at sign-in for a reason that has nothing to do with
 * what it was testing. Set E2E_PASSWORD_FUNDER and friends to point it at the
 * real values. Never commit a changed password here.
 */
function pw(role: string, seeded: string): string {
  return process.env[`E2E_PASSWORD_${role}`] ?? seeded
}
export const ACCOUNTS = {
  superAdmin: { email: 'admin@innovalanga.co.za', password: pw('SUPERADMIN', 'Admin@1234'), role: 'super_admin' },
  facilitator: {
    email: 'facilitator@innovalanga.co.za',
    password: pw('FACILITATOR', 'Facilitator@1234'),
    role: 'facilitator',
  },
  mentor: { email: 'mentor1@innovalanga.co.za', password: pw('MENTOR', 'Mentor@1234'), role: 'mentor' },
  innovator: { email: 'zanele@innovalanga.co.za', password: pw('INNOVATOR', 'Innovator@1234'), role: 'innovator' },
  funder: { email: 'funder@tia.gov.za', password: pw('FUNDER', 'Funder@1234'), role: 'funder_viewer' },
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
