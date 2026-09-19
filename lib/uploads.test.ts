import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isAllowedUploadType,
  extensionFor,
  safeDisplayName,
  buildGrantProofKey,
  buildFinanceProofKey,
  buildStipendProofKey,
  MAX_UPLOAD_BYTES,
} from './uploads'

/**
 * The upload helpers had no tests, which is a poor place for that to be true:
 * two of them decide what a storage key looks like, and the routes validate an
 * incoming key against a regex written to match. If a builder and its pattern
 * ever disagree, every upload of that kind is refused with "Invalid storage key"
 * and nothing says why.
 *
 * So the patterns below are copied from the routes deliberately. A change to
 * either side fails here rather than in production.
 */

/** From app/api/grants/[id]/expenditures/[expenditureId]/proof/route.ts */
const GRANT_KEY_PATTERN =
  /^finance\/grants\/[A-Za-z0-9_-]+\/proof\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/

/** From app/api/finance/proofs/route.ts */
const FINANCE_KEY_PATTERN =
  /^finance\/[A-Za-z0-9_-]+\/proof\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/

const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

test('a grant proof key matches the pattern its route validates with', () => {
  const key = buildGrantProofKey('cmu79e7vj000dpt374bz6w621', UUID, 'application/pdf')
  assert.match(key, GRANT_KEY_PATTERN)
  assert.equal(key, `finance/grants/cmu79e7vj000dpt374bz6w621/proof/${UUID}.pdf`)
})

test('every allowed type produces a grant key the route accepts', () => {
  // An allowlist entry whose extension breaks the pattern would refuse that file
  // type at the record step, after the upload has already succeeded.
  for (const type of ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']) {
    assert.match(buildGrantProofKey('exp1', UUID, type), GRANT_KEY_PATTERN, type)
  }
})

test('a grant key cannot pass as a project key, or the reverse', () => {
  // Better than I assumed when writing this: the project pattern's path segment
  // excludes the separator, so a grant key has one segment too many and does not
  // match it at all. The namespaces cannot be confused even before the prefix
  // check each route also performs.
  const grantKey = buildGrantProofKey('exp1', UUID, 'application/pdf')
  const projectKey = buildFinanceProofKey('proj1', UUID, 'application/pdf')

  assert.doesNotMatch(grantKey, FINANCE_KEY_PATTERN)
  assert.doesNotMatch(projectKey, GRANT_KEY_PATTERN)
  assert.match(grantKey, GRANT_KEY_PATTERN)
  assert.match(projectKey, FINANCE_KEY_PATTERN)
})

test('keys are namespaced by owner, so deleting one cannot orphan another', () => {
  const grant = buildGrantProofKey('x1', UUID, 'application/pdf')
  const project = buildFinanceProofKey('x1', UUID, 'application/pdf')
  const stipend = buildStipendProofKey('x1', UUID, 'application/pdf')
  assert.equal(new Set([grant, project, stipend]).size, 3)
})

test('everything lives under the finance prefix the instance role is granted', () => {
  // Widening that prefix means deploying the stack that holds the instance,
  // which replaces the instance. A key outside it is an outage to fix.
  for (const key of [
    buildGrantProofKey('a', UUID, 'image/png'),
    buildFinanceProofKey('a', UUID, 'image/png'),
    buildStipendProofKey('a', UUID, 'image/png'),
  ]) {
    assert.equal(key.startsWith('finance/'), true, key)
  }
})

test('the allowlist admits receipts and refuses anything executable', () => {
  assert.equal(isAllowedUploadType('application/pdf'), true)
  assert.equal(isAllowedUploadType('image/jpeg'), true)

  for (const type of [
    'text/html',
    'image/svg+xml',
    'application/javascript',
    'application/x-msdownload',
    '',
  ]) {
    assert.equal(isAllowedUploadType(type), false, type)
  }
})

test('extensionFor never returns something that could start a second extension', () => {
  for (const type of ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']) {
    const ext = extensionFor(type)
    assert.match(ext, /^[a-z0-9]{2,5}$/, `${type} -> ${ext}`)
  }
})

test('safeDisplayName removes what could break a Content-Disposition header', () => {
  // This value is echoed into `attachment; filename="..."`, so separators,
  // quotes and control characters are the surface that matters. A leftover '..'
  // is deliberately fine: the name never becomes a filesystem path and never
  // reaches the storage key, which is built only from server-held values.
  const SLASH = String.fromCharCode(47)
  const BACKSLASH = String.fromCharCode(92)
  const QUOTE = String.fromCharCode(34)

  for (const nasty of [
    '..' + SLASH + '..' + SLASH + 'etc' + SLASH + 'passwd',
    'a' + SLASH + 'b' + SLASH + 'c.pdf',
    'C:' + BACKSLASH + 'temp' + BACKSLASH + 'x.pdf',
  ]) {
    const safe = safeDisplayName(nasty)
    assert.equal(safe.includes(SLASH), false, safe)
    assert.equal(safe.includes(BACKSLASH), false, safe)
  }

  assert.equal(safeDisplayName('in' + QUOTE + 'voice.pdf').includes(QUOTE), false)
  assert.equal(safeDisplayName('a<b>c.pdf'), 'abc.pdf')

  // Control characters would split the header into a second one.
  const injected = safeDisplayName('receipt.pdf' + String.fromCharCode(13, 10) + 'X-Evil: yes')
  assert.equal(injected.includes(String.fromCharCode(13)), false)
  assert.equal(injected.includes(String.fromCharCode(10)), false)

  // The fallback catches an empty result only. A name made entirely of
  // separators becomes dashes, which is odd to read and harmless in a header -
  // asserted so the distinction is deliberate rather than assumed.
  assert.equal(safeDisplayName(''), 'document')
  assert.equal(safeDisplayName(SLASH + SLASH + SLASH), '---')
})

test('the size cap is a sane bound for a photographed receipt', () => {
  assert.equal(MAX_UPLOAD_BYTES, 20 * 1024 * 1024)
})
