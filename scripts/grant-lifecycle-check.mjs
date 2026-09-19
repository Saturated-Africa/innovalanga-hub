/**
 * Walks one grant through its whole life in a real browser, across three roles.
 *
 * This is a one-off check rather than a committed spec, because every run awards
 * a real grant and consumes part of a programme's allocation. A permanent test
 * doing that needs a teardown story first; this needs an answer today.
 *
 * It exists because the build tells you nothing about any of this. Each step is
 * a place the previous version of this module simply had no code:
 *
 *   super_admin  awards a grant with a two-tranche schedule
 *   super_admin  approves the grant, then activates it - a Draft grant cannot pay
 *   super_admin  approves tranche 1, then records its payment
 *   innovator    reports an expense, with a receipt attached
 *   facilitator  queries the expense with a note
 *   innovator    answers the query
 *   facilitator  accepts it, and the unaccounted figure moves
 *
 * Run: node scripts/grant-lifecycle-check.mjs
 */
import { chromium } from '@playwright/test'

/**
 * The smallest thing that is really a PDF.
 *
 * A .pdf named text file would pass the extension check and fail the content
 * type one, so the check would prove nothing about the allowlist. This is a
 * valid single page document.
 */
const TINY_PDF = Buffer.from(
  [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 99 9]>>endobj',
    'trailer<</Root 1 0 R>>',
    '%%EOF',
    '',
  ].join(String.fromCharCode(10)),
  'latin1'
)

const BASE = process.env.E2E_BASE_URL ?? 'https://hub.innovalanga.co.za'
const STAMP = Date.now().toString().slice(-6)
const AWARD = 400 // Small on purpose: every run spends the allocation.

/** Must match the account the innovator steps sign in as. */
const PARTICIPANT = 'Zanele'

const ACCOUNTS = {
  admin: { email: 'admin@innovalanga.co.za', password: 'Admin@1234' },
  facilitator: { email: 'facilitator@innovalanga.co.za', password: 'Facilitator@1234' },
  innovator: { email: 'zanele@innovalanga.co.za', password: 'Innovator@1234' },
}

const results = []
function record(step, ok, detail = '') {
  results.push({ step, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ` — ${detail}` : ''}`)
}

/**
 * Click a control, or say why it is disabled.
 *
 * The first run of this script spent thirty seconds timing out on a disabled
 * payment button while the page had "The grant has not been approved yet."
 * printed directly underneath it. A check that ignores the answer on screen
 * turns a one-line diagnosis into an interrogation of a stack trace.
 */
async function clickOrExplain(page, locator, step) {
  const target = locator.first()
  await target.waitFor({ state: 'visible', timeout: 20_000 })
  if (await target.isDisabled()) {
    const text = await page.locator('body').innerText().catch(() => '')
    const reason =
      text
        .split(String.fromCharCode(10))
        .map((line) => line.trim())
        .find((line) =>
          /not been approved|already been paid|being withheld|cancelled/i.test(line)
        ) ?? 'no reason shown on the page'
    throw new Error(`${step}: the control is disabled — ${reason.trim()}`)
  }
  await target.click()
}

async function signIn(page, who) {
  const { email, password } = ACCOUNTS[who]
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.click('button[type=submit]')
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45_000 })
  // Asserting the landing URL, not the status code. A valid session that the
  // middleware cannot see redirects to /login with a 200, which is exactly the
  // bug a status check missed on this deployment once already.
  if (page.url().includes('/login')) throw new Error(`${who} bounced back to /login`)
}

const browser = await chromium.launch()
let grantUrl = null

try {
  // ---------- award ----------
  {
    const page = await browser.newPage()
    await signIn(page, 'admin')
    await page.goto(`${BASE}/dashboard/grants`, { waitUntil: 'domcontentloaded' })

    await page.click('button:has-text("Award a grant")')
    await page.waitForSelector('text=Payment schedule', { timeout: 15_000 })

    // Selects are Radix triggers, so they are opened and chosen, not typed into.
    await page.click('#grant-fund')
    await page.click('[role=option]')
    await page.click('#grant-participant')
    // By name, not by position. Taking the first option awarded the grant to
    // whoever sorts first alphabetically while this script signs in as Zanele,
    // so the participant step failed on a grant that was never hers - the
    // person-scoping working correctly, reported as a defect.
    await page.locator('[role=option]', { hasText: PARTICIPANT }).first().click()
    await page.click('#grant-entity-type')
    await page.locator('[role=option]').first().click()

    await page.fill('#grant-entity-name', `Lifecycle Check ${STAMP}`)
    await page.fill('#grant-purpose', 'Automated check of the grant lifecycle.')
    await page.fill('#grant-amount', String(AWARD))

    await page.click('button:has-text("Add a tranche")')
    await page.click('button:has-text("Split evenly")')

    const reconciliation = await page.locator('text=matching the award').count()
    record('tranche reconciliation reaches zero', reconciliation > 0)

    await page.click('button:has-text("Award the grant")')
    await page.waitForURL(/\/dashboard\/grants\/[^/]+$/, { timeout: 45_000 })
    grantUrl = page.url()
    record('super_admin awards a grant', true, grantUrl.split('/').pop())
    await page.close()
  }

  // ---------- activate the grant, then approve and pay tranche 1 ----------
  {
    const page = await browser.newPage()
    await signIn(page, 'admin')
    await page.goto(grantUrl, { waitUntil: 'domcontentloaded' })

    // A grant is created as Draft and canPayTranche refuses to pay a Draft
    // grant. The first version of this check found exactly that: an awarded
    // grant with a disabled payment button and no way in the UI to move it on.
    for (const step of ['Approve it', 'Activate it']) {
      await page.locator('button:has-text("Draft"), button:has-text("Approved")').first().click()
      await page.locator(`text=${step}`).click()
      await page.waitForTimeout(2_500)
      await page.reload({ waitUntil: 'domcontentloaded' })
    }
    const active = await page.locator('button:has-text("Active")').count()
    record('grant is approved and activated', active > 0)

    // Payment is only offered on an Approved tranche, which is the control the
    // whole schedule exists for - so approving is a step, not a formality.
    await clickOrExplain(page, page.locator('button:has-text("Approve")'), 'approve tranche 1')
    await page.waitForTimeout(3_000)
    await page.reload({ waitUntil: 'domcontentloaded' })
    const approved = await page.locator('text=Approved').count()
    record('tranche 1 is approved', approved > 0)

    await clickOrExplain(
      page,
      page.locator('button:has-text("Record payment")'),
      'record payment'
    )
    await page.waitForSelector('#paidOn', { timeout: 15_000 })
    await page.fill('#paidOn', new Date().toISOString().slice(0, 10))
    // The dialog's own confirm carries the same words as the trigger, so the
    // last match is the one inside it.
    await page.locator('button:has-text("Record payment")').last().click()
    await page.waitForTimeout(3_000)
    await page.reload({ waitUntil: 'domcontentloaded' })
    const paid = await page.locator('text=Paid').count()
    record('tranche 1 is paid', paid > 0)
    await page.close()
  }

  // ---------- participant reports an expense ----------
  {
    const page = await browser.newPage()
    await signIn(page, 'innovator')
    await page.goto(`${BASE}/dashboard/innovator/grant`, { waitUntil: 'domcontentloaded' })

    const visible = await page.locator(`text=Lifecycle Check ${STAMP}`).count()
    record('participant sees their own grant', visible > 0)

    await page.click('button:has-text("Report an expense")')
    await page.fill('#exp-date', new Date().toISOString().slice(0, 10))
    await page.fill('#exp-amount', '150')
    await page.fill('#exp-supplier', `Supplier ${STAMP}`)
    await page.fill('#exp-description', 'Materials bought for the build.')

    // Attached at the moment of reporting, which is the path a participant
    // actually takes. Anything else tests a screen nobody uses first.
    await page.setInputFiles('#exp-proof', {
      name: `receipt-${STAMP}.pdf`,
      mimeType: 'application/pdf',
      buffer: TINY_PDF,
    })

    await page.click('button:has-text("Submit it")')
    await page.waitForTimeout(3_000)
    await page.reload({ waitUntil: 'domcontentloaded' })
    const submitted = await page.locator(`text=Supplier ${STAMP}`).count()
    record('participant reports an expense', submitted > 0)

    const receipt = await page.locator(`text=receipt-${STAMP}.pdf`).count()
    record('the receipt is attached and linked', receipt > 0)
    await page.close()
  }

  // ---------- facilitator queries it ----------
  {
    const page = await browser.newPage()
    await signIn(page, 'facilitator')
    await page.goto(grantUrl, { waitUntil: 'domcontentloaded' })
    await page.locator('button:has-text("Query")').first().click()
    await page.fill('#review-note', 'Please attach the invoice for this amount.')
    await page.click('button:has-text("Send the query")')
    await page.waitForTimeout(3_000)
    await page.reload({ waitUntil: 'domcontentloaded' })
    const queried = await page.locator('text=Queried').count()
    record('facilitator queries the expense', queried > 0)

    // The reviewer must see the evidence, and must not be told there is none.
    const sawReceipt = await page.locator(`text=receipt-${STAMP}.pdf`).count()
    const sawWarning = await page.locator('text=No receipt attached').count()
    record('the reviewer sees the receipt, not the missing-receipt warning',
      sawReceipt > 0 && sawWarning === 0)
    await page.close()
  }

  // ---------- participant answers ----------
  {
    const page = await browser.newPage()
    await signIn(page, 'innovator')
    await page.goto(`${BASE}/dashboard/innovator/grant`, { waitUntil: 'domcontentloaded' })
    const sawNote = await page.locator('text=Please attach the invoice').count()
    record('participant sees the query note', sawNote > 0)

    await page.click('button:has-text("I have sorted this out")')
    await page.waitForTimeout(3_000)
    await page.reload({ waitUntil: 'domcontentloaded' })
    const back = await page.locator('text=Submitted').count()
    record('participant answers the query', back > 0)
    await page.close()
  }

  // ---------- facilitator accepts ----------
  {
    const page = await browser.newPage()
    await signIn(page, 'facilitator')
    await page.goto(grantUrl, { waitUntil: 'domcontentloaded' })
    await page.locator('button:has-text("Accept")').first().click()
    await page.waitForTimeout(3_000)
    await page.reload({ waitUntil: 'domcontentloaded' })
    const accepted = await page.locator('text=Accepted').count()
    record('facilitator accepts the expense', accepted > 0)

    // The whole point: accepting moves the figure a funder reads.
    const body = await page.locator('body').innerText()
    record(
      'the unaccounted figure is present on the page',
      /Unaccounted/i.test(body),
      body.match(/Unaccounted[\s\S]{0,40}/)?.[0]?.replace(/\s+/g, ' ').trim() ?? ''
    )
    await page.close()
  }
} catch (err) {
  record('lifecycle run', false, err.message)
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (grantUrl) console.log(`grant: ${grantUrl}`)
process.exit(failed.length === 0 ? 0 : 1)
