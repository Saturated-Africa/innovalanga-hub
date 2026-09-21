/**
 * Does an assessor actually see the rubric?
 *
 * The rubric's whole value is being read at the moment a score is chosen. Unit tests
 * prove the content is correct and consistent with the platform's level names; they
 * cannot prove it reaches the screen. This opens the assessment form as a
 * facilitator, changes a score, and checks the criteria and evidence change with it.
 *
 * Run: node scripts/rubric-check.mjs
 */
import { chromium } from '@playwright/test'

const BASE = process.env.E2E_BASE_URL ?? 'https://hub.innovalanga.co.za'
const ACCOUNT = {
  email: process.env.E2E_EMAIL_FACILITATOR ?? 'facilitator@innovalanga.co.za',
  password: process.env.E2E_PASSWORD_FACILITATOR ?? 'Facilitator@1234',
}

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
  record('facilitator signs in', !page.url().includes('/login'))

  await page.goto(`${BASE}/dashboard/assessments/new`, { waitUntil: 'domcontentloaded' })
  const body = await page.locator('body').innerText()
  record('the assessment form loads', /readiness/i.test(body), page.url())

  // The rules, which used to live nowhere.
  record('the scoring rules are on the form', /every criterion/i.test(body))
  record('no-skipping rule is stated', /no skipping/i.test(body))

  // Level 1 guidance for each dimension is what shows before anything is touched.
  record(
    'TRL level 1 criteria are shown',
    /rests on a principle known to work/i.test(body)
  )
  record('evidence is shown, not just criteria', /Evidence on file/i.test(body))

  // The South African specifics, which are the reason for a local rubric.
  await page
    .locator('button', { hasText: /^5$/ })
    .first()
    .click()
    .catch(() => {})
  await page.waitForTimeout(600)
  const atFive = await page.locator('body').innerText()
  record(
    'changing the score changes the guidance',
    /grid power/i.test(atFive) && !/rests on a principle known to work/i.test(atFive)
  )

  // BRL 6's compliance evidence is asserted in lib/readiness-rubric.test.ts rather
  // than here. My first attempt at a browser assertion for it ended in `|| true`,
  // which passes whatever the page says - a check that cannot fail is worse than no
  // check, because it reads as coverage.
} catch (err) {
  record('rubric run', false, err.message)
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
