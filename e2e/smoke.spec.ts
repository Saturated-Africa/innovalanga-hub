import { test, expect } from '@playwright/test'
import { signIn } from './helpers'
import { ACCOUNTS, LANDING, type AccountKey } from './accounts'

/**
 * Does the deployment work at all.
 *
 * Run this first after a deploy: if these fail, nothing else is worth reading.
 */

test('the health endpoint is up', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.status()).toBe(200)
  expect((await res.json()).status).toBe('ok')
})

test('the database is reachable', async ({ request }) => {
  // The deep variant runs SELECT 1. A 503 here means the container is healthy
  // but Postgres is not, which is a different problem from the app being down.
  const res = await request.get('/api/health?deep=1')
  expect(res.status(), 'database unreachable from the container').toBe(200)
  expect((await res.json()).database).toBe('up')
})

test('the login page carries the brand, not the shadcn default', async ({ page }) => {
  await page.goto('/login')
  await expect(page.locator('h1')).toContainText('Sign in')
  await expect(page.getByText('Innovation thrives where the sun rises.')).toBeVisible()

  // The sign-in button is volt with INK text. White on volt is 1.27:1, so if
  // this ever regresses the primary action becomes invisible.
  const colour = await page
    .locator('button[type=submit]')
    .evaluate((el) => getComputedStyle(el).color)
  const [r, g, b] = colour.match(/\d+/g)!.map(Number)
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  expect(luminance, 'the primary button must carry ink, not white').toBeLessThan(0.4)
})

test('unauthenticated requests are refused, not redirected to a broken page', async ({ request }) => {
  const dashboard = await request.get('/dashboard', { maxRedirects: 0, failOnStatusCode: false })
  expect([302, 307, 200]).toContain(dashboard.status())

  const assistant = await request.post('/api/assistant', {
    data: { messages: [{ role: 'user', content: 'hi' }] },
    failOnStatusCode: false,
  })
  expect(assistant.status()).toBe(401)
})

for (const key of Object.keys(ACCOUNTS) as AccountKey[]) {
  test(`${ACCOUNTS[key].role} can sign in and lands on the right page`, async ({ page }) => {
    await signIn(page, key)
    await expect(page).toHaveURL(LANDING[key])
    // The shell rendered, so the session resolved and the sidebar filtered.
    await expect(page.locator('body')).toContainText(/Innovalanga/i)
  })
}
