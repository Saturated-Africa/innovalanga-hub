/**
 * Does accepting a beneficiary form actually produce a participant?
 *
 * Before this was built, onboarding produced signed, accepted records that no
 * assessment, booking, stipend or grant could attach to, because none of those
 * hang off a beneficiary record - they hang off an InnovatorProfile. The form
 * model always said `innovatorId` is "set when the record is accepted". Nothing
 * set it.
 *
 * Driven through the API with a signed-in browser session rather than by clicking
 * the capture wizard, because two of its three steps are signature pads and
 * drawing on a canvas proves nothing about the linking this exists to check. The
 * assertions at the end are on rendered pages, not on the API's own answer.
 *
 * Run: node scripts/beneficiary-onboarding-check.mjs
 */
import { chromium } from '@playwright/test'

const BASE = process.env.E2E_BASE_URL ?? 'https://hub.innovalanga.co.za'
const STAFF = {
  email: process.env.E2E_EMAIL_FACILITATOR ?? 'facilitator@innovalanga.co.za',
  password: process.env.E2E_PASSWORD_FACILITATOR ?? 'Facilitator@1234',
}

const STAMP = Date.now().toString().slice(-6)

/**
 * A 13 digit SA ID that passes the Luhn check, born 1 January 2000.
 *
 * Supplied so the capture path derives a date of birth, which is what makes the
 * youth figure derivable at all. Computed rather than hardcoded so a typo cannot
 * quietly make it invalid and have the record saved without an ID.
 */
const ID_NUMBER = (() => {
  const stem = '000101500108'
  for (let check = 0; check <= 9; check++) {
    const candidate = `${stem}${check}`
    let sum = 0
    let alt = false
    for (let i = candidate.length - 1; i >= 0; i--) {
      let n = Number(candidate[i])
      if (alt) {
        n *= 2
        if (n > 9) n -= 9
      }
      sum += n
      alt = !alt
    }
    if (sum % 10 === 0) return candidate
  }
  throw new Error('no valid check digit for the ID fixture')
})()
const NAME = `Thandiwe Onboarding${STAMP} Nkosi`
const EMAIL = `onboarding-${STAMP}@innovalanga.test`

/**
 * A 1x1 PNG as a data URL - the smallest thing the signature schema accepts.
 *
 * The schema requires a PNG data URL and bounds its decoded size; it does not
 * care what the picture is. A drawn squiggle would test the canvas, not the
 * linking.
 */
const SIGNATURE =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP6zwAAAgUBAV' +
  'nqEpsAAAAASUVORK5CYII='

const results = []
function record(step, ok, detail = '') {
  results.push({ step, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()
const page = await browser.newPage()

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#email', STAFF.email)
  await page.fill('#password', STAFF.password)
  await page.click('button[type=submit]')
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45_000 })
  record('facilitator signs in', !page.url().includes('/login'))

  // A cohort is required to accept, deliberately: a participant without one
  // cannot be assessed and appears in no cohort report.
  //
  // Taken from the cohorts page, because there is no cohorts API - the pages that
  // need them read them server-side. Scraping one link is less machinery than
  // adding a route this check would be the only caller of.
  await page.goto(`${BASE}/dashboard/cohorts`, { waitUntil: 'domcontentloaded' })
  const cohortHref = await page
    .locator('a[href^="/dashboard/cohorts/"]')
    .first()
    .getAttribute('href')
    .catch(() => null)
  const cohortId = cohortHref ? cohortHref.split('/').pop() : null
  record('a cohort is available to assign', Boolean(cohortId), cohortId ?? 'none')
  if (!cohortId) throw new Error('no cohort to assign; cannot accept a form')

  const created = await page.request.post(`${BASE}/api/beneficiaries`, {
    failOnStatusCode: false,
    // The form refuses a signature until it is complete, which is correct - a
    // signature over a half-filled form evidences nothing. So this sends the
    // whole thing.
    data: {
      fullName: NAME,
      email: EMAIL,
      cohortId,
      idNumber: ID_NUMBER,
      gender: 'Female',
      hasDisability: false,
      race: 'Black',
      title: 'Ms',
      physicalAddress: '12 Test Street, Giyani',
      province: 'Limpopo',
      localMunicipality: 'Greater Giyani',
      districtMunicipality: 'Mopani',
      cellphone: '0821234567',
      entityType: 'PtyLtd',
      entityName: `Onboarding Check Enterprises ${STAMP}`,
      // Ends /07, which is what a private company's number ends in. The server
      // checks the suffix against the type, so this pair has to agree.
      entityRegistrationNumber: '2016/123456/07',
      hasInnovativeIdea: true,
      projectTitle: `Onboarding Check ${STAMP}`,
      sector: 'Agriculture',
      developmentStage: 'Concept',
      conceptDescription: 'A record created by the onboarding check.',
    },
  })
  const createdBody = await created.json().catch(() => ({}))
  record('a beneficiary record is created', created.ok(), `${created.status()}`)
  if (!created.ok()) throw new Error(JSON.stringify(createdBody).slice(0, 300))
  const recordId = createdBody.id

  // A number whose suffix contradicts the entity type must be refused. /08 is a
  // non-profit company, so it cannot belong to a (Pty) Ltd.
  const mismatched = await page.request.patch(`${BASE}/api/beneficiaries/${recordId}`, {
    failOnStatusCode: false,
    data: { entityType: 'PtyLtd', entityRegistrationNumber: '2016/123456/08' },
  })
  const mismatchBody = await mismatched.text()
  record(
    'a registration number that contradicts the entity type is refused',
    !mismatched.ok() && /non-profit|one of the two/i.test(mismatchBody),
    `${mismatched.status()}`
  )

  // The CIPC certificate: presign, PUT to storage, then record it.
  const presigned = await page.request.post(
    `${BASE}/api/beneficiaries/${recordId}/documents`,
    {
      failOnStatusCode: false,
      data: {
        filename: `cipc-${STAMP}.pdf`,
        contentType: 'application/pdf',
        sizeBytes: TINY_PDF.length,
        type: 'cipc_registration',
      },
    }
  )
  const presignedBody = await presigned.json().catch(() => ({}))
  record('a certificate upload can be started', presigned.ok(), `${presigned.status()}`)

  if (presigned.ok()) {
    const put = await page.request.put(presignedBody.url, {
      failOnStatusCode: false,
      headers: { 'Content-Type': 'application/pdf' },
      data: TINY_PDF,
    })
    // This is the step that fails when the storage prefix is not granted to the
    // instance, which is a configuration problem rather than a code one.
    record('storage accepts the certificate', put.ok(), `${put.status()}`)

    const recorded = await page.request.put(
      `${BASE}/api/beneficiaries/${recordId}/documents`,
      {
        failOnStatusCode: false,
        data: {
          filename: `cipc-${STAMP}.pdf`,
          contentType: 'application/pdf',
          sizeBytes: TINY_PDF.length,
          type: 'cipc_registration',
          s3Key: presignedBody.s3Key,
        },
      }
    )
    record('the certificate is recorded against the form', recorded.ok(), `${recorded.status()}`)
  }

  const signed = await page.request.post(`${BASE}/api/beneficiaries/${recordId}/sign`, {
    failOnStatusCode: false,
    data: { signedName: NAME, signatureImage: SIGNATURE, confirmed: true },
  })
  record('the beneficiary signs', signed.ok(), `${signed.status()}`)
  if (!signed.ok()) throw new Error((await signed.text()).slice(0, 300))

  const accepted = await page.request.post(
    `${BASE}/api/beneficiaries/${recordId}/accept`,
    {
      failOnStatusCode: false,
      data: {
        acceptedByName: 'Onboarding Check',
        signatureImage: SIGNATURE,
        confirmed: true,
      },
    }
  )
  const acceptedBody = await accepted.json().catch(() => ({}))
  record('the centre accepts it', accepted.ok(), `${accepted.status()}`)
  if (!accepted.ok()) throw new Error(JSON.stringify(acceptedBody).slice(0, 300))

  record(
    'acceptance returns a participant',
    Boolean(acceptedBody.participant?.id),
    acceptedBody.participant?.id ?? 'none'
  )
  record(
    'a one-time password is returned for the new account',
    typeof acceptedBody.temporaryPassword === 'string' &&
      acceptedBody.temporaryPassword.length >= 16
  )

  // The assertions that matter: the participant is real on the pages that use
  // participants, not merely present in the response body.
  await page.goto(`${BASE}/dashboard/innovators`, { waitUntil: 'domcontentloaded' })
  const inRegister = await page.locator(`text=Onboarding${STAMP}`).count()
  record('the participant appears in the innovators register', inRegister > 0)

  const profileId = acceptedBody.participant?.id
  if (profileId) {
    await page.goto(`${BASE}/dashboard/innovators/${profileId}`, {
      waitUntil: 'domcontentloaded',
    })
    const body = await page.locator('body').innerText()
    record('their profile page renders', /Onboarding/i.test(body))
    record(
      'the project came across as the business',
      body.includes(`Onboarding Check ${STAMP}`)
    )
  }

  // The date of birth is what makes the youth figure derivable, so assert it was
  // stored rather than trusting that deriving it worked.
  const detail = await page.request.get(`${BASE}/api/beneficiaries/${recordId}`, {
    failOnStatusCode: false,
  })
  if (detail.ok()) {
    const body = await detail.json().catch(() => ({}))
    record(
      'a date of birth was derived from the ID number',
      typeof body.dateOfBirth === 'string' && body.dateOfBirth.startsWith('2000-01-01'),
      String(body.dateOfBirth)
    )
  }

  // The certificate must now belong to the participant as well, or it would sit in
  // storage attached to a record nobody looks at again.
  if (acceptedBody.participant?.id) {
    await page.goto(`${BASE}/dashboard/innovators/${acceptedBody.participant.id}`, {
      waitUntil: 'domcontentloaded',
    })
    const vault = await page.locator('body').innerText()
    record(
      'the certificate appears in the participant document vault',
      vault.includes(`cipc-${STAMP}.pdf`) || /CIPC Registration/i.test(vault)
    )
  }

  // Accepting twice must not make a second participant.
  const again = await page.request.post(`${BASE}/api/beneficiaries/${recordId}/accept`, {
    failOnStatusCode: false,
    data: {
      acceptedByName: 'Onboarding Check',
      signatureImage: SIGNATURE,
      confirmed: true,
    },
  })
  record('accepting twice is refused', !again.ok(), `${again.status()}`)
} catch (err) {
  record('onboarding run', false, err.message)
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
