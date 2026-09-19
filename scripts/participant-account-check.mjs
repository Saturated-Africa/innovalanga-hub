/**
 * Can a participant find and use their own account page?
 *
 * Written because the report was that participants have nowhere to change a
 * password or fix their details. Half of that was already built and reachable,
 * and the way to settle which half is to be the participant rather than to read
 * the route table.
 *
 * The details edit is reversible: it writes a value, asserts it came back after a
 * reload, then puts the original back. A check that leaves a participant's phone
 * number changed is a check nobody will want to run twice.
 *
 * Run: node scripts/participant-account-check.mjs
 */
import { chromium } from '@playwright/test'

const BASE = process.env.E2E_BASE_URL ?? 'https://hub.innovalanga.co.za'
const ACCOUNT = {
  email: process.env.E2E_EMAIL_INNOVATOR ?? 'zanele@innovalanga.co.za',
  password: process.env.E2E_PASSWORD_INNOVATOR ?? 'Innovator@1234',
}

const STAMP = Date.now().toString().slice(-5)

const results = []
function record(step, ok, detail = '') {
  results.push({ step, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()
const page = await browser.newPage()

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#email', ACCOUNT.email)
  await page.fill('#password', ACCOUNT.password)
  await page.click('button[type=submit]')
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45_000 })
  record('participant signs in', !page.url().includes('/login'), page.url())

  // The link, not just the route. A page that exists and is not linked is a page
  // nobody uses, which is what the report was actually about.
  const link = await page.locator('a[href="/dashboard/account"]').count()
  record('"Your account" is linked in the sidebar', link > 0)

  await page.goto(`${BASE}/dashboard/account`, { waitUntil: 'domcontentloaded' })
  record('the account page loads, not a redirect away', page.url().includes('/dashboard/account'), page.url())

  const body = await page.locator('body').innerText()
  record('the page offers a password change', /password/i.test(body))
  record('the page offers their details', /Your details/i.test(body))

  // Cohort and region are staff-set, so they must not appear as fields here.
  const cohortField = await page.locator('#own-cohort, input[name=cohortId]').count()
  const regionField = await page.locator('#own-region, input[name=regionId]').count()
  record('cohort and region are absent, not editable', cohortField === 0 && regionField === 0)

  const originalPhone = await page.inputValue('#own-phone').catch(() => null)
  const originalBusiness = await page.inputValue('#own-business').catch(() => null)
  if (originalPhone === null) {
    record('the details form is present', false, 'no #own-phone field')
  } else {
    record('the details form is present', true)

    const newBusiness = `Mthembu Agri ${STAMP}`
    await page.fill('#own-phone', '0829998877')
    await page.fill('#own-business', newBusiness)
    await page.click('button:has-text("Save changes")')
    await page.waitForTimeout(3_000)
    await page.reload({ waitUntil: 'domcontentloaded' })

    const savedPhone = await page.inputValue('#own-phone')
    const savedBusiness = await page.inputValue('#own-business')
    record('an edit persists across a reload', savedPhone === '0829998877' && savedBusiness === newBusiness,
      `${savedPhone} / ${savedBusiness}`)

    // A bad number must be refused with a message on the field, not saved.
    await page.fill('#own-phone', '12345')
    await page.click('button:has-text("Save changes")')
    await page.waitForTimeout(2_500)
    const refused = await page.locator('text=South African number').count()
    record('an invalid phone number is refused on the field', refused > 0)

    // Put it back, so the next run starts where this one did.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.fill('#own-phone', originalPhone ?? '')
    await page.fill('#own-business', originalBusiness ?? '')
    await page.click('button:has-text("Save changes")')
    await page.waitForTimeout(3_000)
    await page.reload({ waitUntil: 'domcontentloaded' })
    const restored = (await page.inputValue('#own-phone')) === (originalPhone ?? '')
    record('the original details are restored', restored)
  }
} catch (err) {
  record('participant account run', false, err.message)
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
