import { test, expect } from '@playwright/test'
import { signIn } from './helpers'
import type { AccountKey } from './accounts'

/**
 * Every page renders without hitting an error boundary.
 *
 * This file exists because the first suite did not have it. It tested API
 * routes and sign-in thoroughly, then declared the deployment good while four
 * pages were throwing on render:
 *
 *   - Innovators, Assessments, Cohorts and Stipends passed `render` functions
 *     from a Server Component to the client `DataTable`, which React refuses in
 *     a production build ("Functions cannot be passed directly to Client
 *     Components"). It works in `next dev`, so it only appeared once deployed.
 *   - Availability called `mentor!.bookingSlug` when a super_admin, who is
 *     allowed on that page, has no MentorProfile.
 *
 * A test that only exercises APIs cannot catch either. These navigate.
 */

interface PageCase {
  path: string
  /** Roles that should see the page render. */
  roles: AccountKey[]
  /** Text that proves the page itself rendered, not just the shell. */
  expect: RegExp
}

const PAGES: PageCase[] = [
  { path: '/dashboard', roles: ['superAdmin', 'facilitator'], expect: /Dashboard/i },
  { path: '/dashboard/innovators', roles: ['superAdmin', 'facilitator'], expect: /Innovators/i },
  { path: '/dashboard/cohorts', roles: ['superAdmin', 'facilitator'], expect: /Cohorts/i },
  { path: '/dashboard/assessments', roles: ['superAdmin', 'facilitator'], expect: /Assessments/i },
  { path: '/dashboard/stipends', roles: ['superAdmin', 'facilitator'], expect: /Stipends/i },
  { path: '/dashboard/reports', roles: ['superAdmin', 'facilitator', 'funder'], expect: /Reports/i },
  { path: '/dashboard/mande', roles: ['superAdmin', 'facilitator', 'funder'], expect: /M&E|Monitoring/i },
  { path: '/dashboard/ip', roles: ['superAdmin', 'facilitator'], expect: /IP/i },
  { path: '/dashboard/mentorship', roles: ['superAdmin', 'facilitator', 'mentor'], expect: /Mentorship/i },
  { path: '/dashboard/sessions', roles: ['superAdmin', 'mentor'], expect: /Sessions/i },
  // Reachable by super_admin, who has no mentor profile. That is the case that
  // crashed, so both roles are covered deliberately.
  { path: '/dashboard/mentor/availability', roles: ['superAdmin', 'mentor'], expect: /Availability/i },
  { path: '/dashboard/admin', roles: ['superAdmin'], expect: /Admin/i },
  { path: '/dashboard/admin/users', roles: ['superAdmin'], expect: /Users/i },
  { path: '/dashboard/innovator/sessions', roles: ['innovator'], expect: /Sessions/i },
  { path: '/dashboard/book', roles: ['innovator'], expect: /Book/i },
  { path: '/dashboard/innovator/ip', roles: ['innovator'], expect: /IP/i },
]

/** Text Next.js or our error boundary shows when a render throws. */
const ERROR_MARKERS = [
  /Something went wrong/i,
  /Application error/i,
  /client-side exception/i,
  /Internal Server Error/i,
  /This page could not be loaded/i,
]

for (const page_ of PAGES) {
  for (const role of page_.roles) {
    test(`${role} can open ${page_.path}`, async ({ page }) => {
      const serverErrors: string[] = []
      page.on('pageerror', (e) => serverErrors.push(String(e)))

      await signIn(page, role)
      const res = await page.goto(page_.path, { waitUntil: 'networkidle' })

      // A 500 means the render threw on the server.
      expect(res?.status(), `${page_.path} returned ${res?.status()}`).toBeLessThan(500)

      const body = await page.locator('body').innerText()
      for (const marker of ERROR_MARKERS) {
        expect(body, `${page_.path} rendered an error boundary`).not.toMatch(marker)
      }

      expect(body).toMatch(page_.expect)
      expect(serverErrors, `${page_.path} threw in the browser`).toHaveLength(0)
    })
  }
}
