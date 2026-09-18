/**
 * Load a deployed page in a real browser and fail if anything did not arrive.
 *
 * This exists because of a bug that passed every other check. A CSP carrying
 * `upgrade-insecure-requests` was deployed to an environment served over plain
 * http. The browser dutifully rewrote every stylesheet, script chunk and font
 * request to https, nothing was listening there, and the site rendered as an
 * unstyled shell with no JavaScript.
 *
 * Health endpoints returned 200. Every security header was present and correct.
 * Seven API routes returned the right status codes. All of it was checked with
 * curl, and curl does not implement CSP, so none of it could see the failure.
 *
 * Anything that depends on how a browser interprets a response - CSP, cookie
 * attributes, mixed content, hydration - needs a browser to verify it.
 *
 *   node scripts/browser-check.mjs http://13.246.217.230
 */
import { chromium } from '@playwright/test'

const base = process.argv[2]
if (!base) {
  console.error('usage: node scripts/browser-check.mjs <base-url>')
  process.exit(2)
}

/** Pages that must render for an unauthenticated visitor. */
const PAGES = [
  { path: '/login', mustHave: 'input[type=password]', label: 'sign-in form' },
  { path: '/register', mustHave: 'input[type=password]', label: 'register form' },
]

const browser = await chromium.launch()
let failures = 0

for (const spec of PAGES) {
  const page = await browser.newPage()
  const failed = []
  const consoleErrors = []

  page.on('requestfailed', (r) =>
    failed.push(`${r.failure()?.errorText} ${r.url()}`)
  )
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })

  const res = await page
    .goto(base + spec.path, { waitUntil: 'load', timeout: 30000 })
    .catch(() => null)

  // Give hydration a moment; a shell that never hydrates is the failure mode.
  await page.waitForTimeout(2500)

  const status = res?.status() ?? 0
  const found = await page.locator(spec.mustHave).count()

  const ok = status === 200 && found > 0 && failed.length === 0

  console.log(`${ok ? 'PASS' : 'FAIL'}  ${spec.path}`)
  console.log(`      status ${status}, ${spec.label}: ${found}, failed requests: ${failed.length}`)

  if (!ok) {
    failures += 1
    for (const f of failed.slice(0, 6)) console.log('      - ' + f.slice(0, 120))
    for (const c of consoleErrors.slice(0, 4)) console.log('      ! ' + c.slice(0, 120))
  }

  await page.close()
}

await browser.close()

if (failures > 0) {
  console.error(`\n${failures} page(s) did not load correctly in a browser.`)
  process.exit(1)
}
console.log('\nAll pages loaded with every subresource.')
