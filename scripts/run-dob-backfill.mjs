/**
 * Run the beneficiary date-of-birth backfill against a deployment.
 *
 * Signs in as the fund manager and calls the guarded maintenance route, because
 * that route needs a super_admin session and runs inside the app where the real
 * decryption lives.
 *
 * Dry run by default. Pass --apply to write, and it then repeats until nothing
 * remains, because each call is deliberately batched - every row costs one scrypt
 * derivation, and a whole table in one request would time out halfway leaving
 * nobody sure how far it got.
 *
 *   node scripts/run-dob-backfill.mjs            # report only
 *   node scripts/run-dob-backfill.mjs --apply    # write
 */
import { chromium } from '@playwright/test'

const BASE = process.env.E2E_BASE_URL ?? 'https://hub.innovalanga.co.za'
const APPLY = process.argv.includes('--apply')
const ACCOUNT = {
  email: process.env.E2E_EMAIL_SUPERADMIN ?? 'admin@innovalanga.co.za',
  password: process.env.E2E_PASSWORD_SUPERADMIN ?? 'Admin@1234',
}

const browser = await chromium.launch()
const page = await browser.newPage()
let failed = false

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#email', ACCOUNT.email)
  await page.fill('#password', ACCOUNT.password)
  await page.click('button[type=submit]')
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45_000 })
  if (page.url().includes('/login')) throw new Error('sign-in bounced back to /login')
  console.log(`signed in as ${ACCOUNT.email}`)
  console.log(APPLY ? 'MODE: applying changes' : 'MODE: dry run, nothing will be written')

  let pass = 0
  for (;;) {
    pass += 1
    const res = await page.request.post(
      `${BASE}/api/admin/backfill/beneficiary-dob`,
      { failOnStatusCode: false, data: { limit: 100, dryRun: !APPLY } }
    )
    const body = await res.json().catch(() => ({}))
    if (!res.ok()) {
      console.log(`FAIL  ${res.status()} ${JSON.stringify(body).slice(0, 300)}`)
      failed = true
      break
    }

    console.log(
      `pass ${pass}: examined ${body.examined}, ` +
        `${APPLY ? 'updated' : 'would update'} ${body.updated}, ` +
        `undecryptable ${body.undecryptable}, unparseable ${body.unparseable}, ` +
        `remaining ${body.remaining}`
    )
    if (body.note) console.log(`        ${body.note}`)

    // A dry run must not loop: nothing was written, so the same rows come back
    // for ever.
    if (!APPLY) break
    if (body.examined === 0 || body.remaining === 0) break
    // Nothing was updatable in this batch, so looping would spin on the same
    // undecryptable or unparseable rows.
    if (body.updated === 0) {
      console.log('        Stopping: the remaining rows cannot be backfilled.')
      break
    }
    if (pass >= 50) {
      console.log('        Stopping after 50 passes. Run again if more remain.')
      break
    }
  }
} catch (err) {
  console.log(`FAIL  ${err.message}`)
  failed = true
} finally {
  await browser.close()
}

process.exit(failed ? 1 : 0)
