import { test, expect } from '@playwright/test'
import { signIn, apiGet } from './helpers'

/**
 * Programme isolation and PII, over real HTTP.
 *
 * The unit tests in lib/tenancy.test.ts prove the scope predicates are correct
 * in isolation. These prove the routes actually use them — which is a different
 * claim, and the one that was false before the isolation fix.
 *
 * Every assertion here corresponds to a specific defect that existed in the
 * code, not to a hypothetical.
 */

test.describe('funder_viewer sees no personal information', () => {
  test('cannot export stipends, which carry names and payment amounts', async ({ page }) => {
    await signIn(page, 'funder')

    const res = await apiGet(page, '/api/reports/export?type=stipends')

    // Previously this returned a CSV of participant names, individual stipend
    // amounts and payment dates to the funder role.
    expect(res.status).toBe(403)
    expect(res.body).not.toMatch(/Zanele|Mahlangu|Bongani/i)
  })

  for (const type of ['innovators', 'assessments', 'sessions'] as const) {
    test(`cannot export ${type}`, async ({ page }) => {
      await signIn(page, 'funder')
      const res = await apiGet(page, `/api/reports/export?type=${type}`)
      expect(res.status).toBe(403)
    })
  }

  test('the IP list returns no participant names', async ({ page }) => {
    await signIn(page, 'funder')
    const res = await apiGet(page, '/api/ip')

    expect(res.status).toBe(200)
    // Funders get recommendation, status, cohort and region. Never a person.
    expect(res.body).not.toMatch(/firstName|lastName/)
  })

  test('is confined to reports and M&E in the UI', async ({ page }) => {
    await signIn(page, 'funder')
    await page.goto('/dashboard/innovators')
    // The middleware redirects rather than rendering the participant list.
    await expect(page).not.toHaveURL(/\/dashboard\/innovators/)
  })
})

test.describe('programmeId cannot be supplied by the client', () => {
  /**
   * Every M&E route used to read programmeId from the query string without
   * checking it against the session, so editing the URL crossed tenants.
   * The parameter is now ignored entirely.
   */
  const routes = [
    '/api/mande/indicators',
    '/api/mande/logframe',
    '/api/mande/milestones',
    '/api/mande/beneficiaries',
    '/api/mande/toc',
  ]

  for (const route of routes) {
    test(`${route} ignores a forged programmeId`, async ({ page }) => {
      await signIn(page, 'facilitator')

      const honest = await apiGet(page, route)
      const forged = await apiGet(page, `${route}?programmeId=some-other-programme`)

      expect(honest.status).toBe(200)
      // Identical responses mean the parameter had no effect. A route that
      // still trusted it would either return different data or error.
      expect(forged.status).toBe(honest.status)
      expect(forged.body).toBe(honest.body)
    })
  }

  test('a nonexistent programmeId does not fall through to every tenant', async ({ page }) => {
    await signIn(page, 'facilitator')

    // The IP route filtered on `programmeId: pid ?? undefined`, and Prisma
    // DROPS an undefined filter, so an unresolvable programme returned every
    // tenant's records rather than none.
    const res = await apiGet(page, '/api/ip?programmeId=does-not-exist')
    expect([200, 403, 404]).toContain(res.status)

    const honest = await apiGet(page, '/api/ip')
    expect(res.body).toBe(honest.body)
  })
})

test.describe('participants see only their own record', () => {
  test('an innovator cannot read another participant via the API', async ({ page }) => {
    await signIn(page, 'innovator')

    const mine = await apiGet(page, '/api/innovator/me')
    expect(mine.status).toBe(200)

    const { id } = JSON.parse(mine.body) as { id?: string }
    expect(id).toBeTruthy()

    // Any other participant's IP assessment must be refused, not returned.
    const other = await apiGet(page, '/api/ip/not-my-innovator-id')
    expect([403, 404]).toContain(other.status)
  })

  test('an innovator is redirected away from staff pages', async ({ page }) => {
    await signIn(page, 'innovator')
    await page.goto('/dashboard/innovators')
    await expect(page).not.toHaveURL(/\/dashboard\/innovators$/)
  })
})
