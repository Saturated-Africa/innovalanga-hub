import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sessionCookieName,
  SECURE_SESSION_COOKIE,
  INSECURE_SESSION_COOKIE,
} from './session-cookie'

/**
 * The cookie name is trivial arithmetic and still broke the platform.
 *
 * Moving the site to HTTPS switched the cookie to the `__Host-` prefix, which
 * is correct. The middleware kept looking for NextAuth's default `__Secure-`
 * name, found nothing, and redirected every authenticated request back to sign
 * in. Sign-in itself worked perfectly, which is what made it hard to see: a
 * valid session was issued each time and then ignored.
 *
 * These tests exist so the two runtimes cannot drift apart again.
 */

test('an https deployment gets the host-prefixed cookie', () => {
  assert.equal(sessionCookieName('https://hub.innovalanga.co.za'), SECURE_SESSION_COOKIE)
})

test('a plain http deployment gets the unprefixed cookie', () => {
  // A sandbox on an IP address cannot hold a certificate, and a __Host- cookie
  // over http is never stored, so sign-in would be impossible there.
  assert.equal(sessionCookieName('http://13.246.217.230'), INSECURE_SESSION_COOKIE)
})

test('an unset url falls back to the insecure name rather than locking everyone out', () => {
  assert.equal(sessionCookieName(undefined), INSECURE_SESSION_COOKIE)
  assert.equal(sessionCookieName(''), INSECURE_SESSION_COOKIE)
})

test('the prefix is __Host-, not __Secure-', () => {
  // __Secure- only requires the Secure attribute. __Host- also forbids a Domain
  // and requires Path=/, so a sibling subdomain cannot set a session cookie the
  // parent would accept. This application is on a subdomain of a domain whose
  // apex hosts an unrelated site.
  assert.ok(SECURE_SESSION_COOKIE.startsWith('__Host-'))
  assert.ok(!SECURE_SESSION_COOKIE.startsWith('__Secure-'))
})

test('the scheme decides, not the hostname', () => {
  assert.equal(sessionCookieName('https://localhost:3000'), SECURE_SESSION_COOKIE)
  assert.equal(sessionCookieName('http://hub.innovalanga.co.za'), INSECURE_SESSION_COOKIE)
})
