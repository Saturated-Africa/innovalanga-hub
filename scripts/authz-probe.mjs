/**
 * Probe the deployed authorisation boundary with a real, low-privilege account.
 *
 *   node scripts/authz-probe.mjs http://host <email> <password>
 *
 * The source-level check in lib/authz.test.ts proves a predicate is called. It
 * cannot prove the predicate is called before the write, or that it resolves
 * the way it reads. This signs in against a running deployment as the least
 * privileged role there is and asks for things that account has no claim on.
 *
 * Run it with a throwaway account after any change to a route's authorisation.
 * Credentials are arguments, never written here.
 */
import { chromium } from '@playwright/test'

const base = process.argv[2]
const email = process.argv[3]
const password = process.argv[4]

const browser = await chromium.launch()
const ctx = await browser.newContext()
const page = await ctx.newPage()

await page.goto(`${base}/login`, { waitUntil: 'networkidle' })
await page.fill('input[type=email]', email)
await page.fill('input[type=password]', password)
await page.click('button[type=submit]')
await page.waitForURL('**/dashboard**', { timeout: 30000 })
console.log('signed in as', email)

// Ids discovered from the account's own pages, then used where they do not belong.
const probes = [
  { label: 'list all users', method: 'GET', url: '/api/admin/users', expect: [403] },
  { label: 'create a user', method: 'POST', url: '/api/admin/users', body: { name: 'Probe Account', email: 'probe@example.test', password: 'Probe@12345', role: 'super_admin' }, expect: [403] },
  { label: 'recalculate a stipend', method: 'POST', url: '/api/stipends/recalculate', body: { stipendRecordId: 'nonexistent' }, expect: [403] },
  { label: 'create an assessment', method: 'POST', url: '/api/assessments', body: { innovatorId: 'x', period: 'baseline', trlScore: 9, brlScore: 9, irlScore: 9 }, expect: [403] },
  { label: 'add an indicator record', method: 'POST', url: '/api/mande/indicators/anything/records', body: { periodLabel: 'Q1', periodStart: '2026-01-01', periodEnd: '2026-03-31', value: 1 }, expect: [403] },
  { label: 'delete an indicator record', method: 'DELETE', url: '/api/mande/indicators/anything/records?recordId=anything', expect: [403] },
  { label: 'read a mentor blackout list', method: 'GET', url: '/api/mentors/nonexistent/blackouts', expect: [404] },
  { label: 'add a mentor blackout', method: 'POST', url: '/api/mentors/nonexistent/blackouts', body: { startDate: '2026-01-01', endDate: '2026-01-02' }, expect: [403] },
  { label: 'add a mentor date override', method: 'POST', url: '/api/mentors/nonexistent/overrides', body: { date: '2026-01-01', available: false }, expect: [403] },
  { label: 'read another programme regions', method: 'GET', url: '/api/programmes/some-other-programme/regions', expect: [404] },
  { label: 'read another programme periods', method: 'GET', url: '/api/programmes/some-other-programme/periods', expect: [404] },
  { label: 'export finance workbook', method: 'GET', url: '/api/finance/projects/cmtvrvhwk0002dx9gqnzx4ydc/export?period=Q1', expect: [403] },
  { label: 'edit a period reconciliation', method: 'PATCH', url: '/api/finance/periods/cmtvrvhyr001qdx9gvyuuxc6a', body: { invoiceNumber: 'TAMPERED' }, expect: [403] },
  { label: 'read another innovator IP assessment', method: 'GET', url: '/api/ip/some-other-innovator', expect: [403, 404] },
  { label: 'amend an IP assessment', method: 'PATCH', url: '/api/ip/some-other-innovator', body: { status: 'Protected' }, expect: [403, 404] },
  { label: 'edit a mentorship log', method: 'PATCH', url: '/api/mentorship/some-booking', body: { notes: 'tampered' }, expect: [403, 404] },
  { label: 'export M&E data', method: 'GET', url: '/api/mande/export?type=indicators', expect: [403] },
]

let failures = 0
for (const probe of probes) {
  const res = await page.request.fetch(`${base}${probe.url}`, {
    method: probe.method,
    headers: { 'Content-Type': 'application/json' },
    data: probe.body ? JSON.stringify(probe.body) : undefined,
  })
  const ok = probe.expect.includes(res.status())
  if (!ok) failures += 1
  console.log(
    `${ok ? 'refused ' : 'ALLOWED '} ${String(res.status()).padEnd(4)} ${probe.label}` +
      (ok ? '' : `  <-- expected ${probe.expect.join(' or ')}`)
  )
}

console.log(failures === 0 ? '\nall probes refused' : `\n${failures} PROBE(S) NOT REFUSED`)
await browser.close()
process.exit(failures === 0 ? 0 : 1)
