import { expect, type Page } from '@playwright/test'
import { ACCOUNTS, type AccountKey } from './accounts'

/**
 * Sign in through the real form rather than by forging a session cookie.
 *
 * Forging the cookie would skip NextAuth's own checks, which is precisely the
 * layer several of these tests are asserting on.
 */
export async function signIn(page: Page, key: AccountKey): Promise<void> {
  const account = ACCOUNTS[key]

  await page.goto('/login')
  await page.fill('#email', account.email)
  await page.fill('#password', account.password)
  await page.click('button[type=submit]')

  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 })
  await expect(page).not.toHaveURL(/\/login/)
}

/**
 * Call an API route with the browser's session cookies attached.
 *
 * Returns status and body so a test can assert on a refusal without Playwright
 * treating a 403 as a failure.
 */
export async function apiGet(page: Page, path: string) {
  const res = await page.request.get(path, { failOnStatusCode: false })
  const body = await res.text()
  return { status: res.status(), body }
}
