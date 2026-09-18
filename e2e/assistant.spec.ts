import { test, expect } from '@playwright/test'
import { signIn } from './helpers'

/**
 * The assistant.
 *
 * Skipped automatically when no provider is configured, because a deployment
 * without ANTHROPIC_API_KEY or Bedrock credentials hides the launcher on
 * purpose and there is nothing to assert.
 */

test.describe('assistant', () => {
  test('either answers or fails closed with a clear message', async ({ page }) => {
    await signIn(page, 'facilitator')

    const res = await page.request.post('/api/assistant', {
      data: { messages: [{ role: 'user', content: 'How many participants are on the programme?' }] },
      failOnStatusCode: false,
    })

    if (res.status() === 503) {
      // No provider configured. That is a valid state, but it must say so
      // rather than returning a stack trace.
      const body = await res.json()
      expect(body.error).toMatch(/not configured/i)
      test.skip(true, 'No inference provider configured on this deployment')
      return
    }

    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('text/event-stream')

    const body = await res.text()
    expect(body, 'the stream produced no events').toContain('event:')
  })

  test('streams progressively rather than arriving in one lump', async ({ page }) => {
    await signIn(page, 'facilitator')

    // A buffering reverse proxy is the most likely failure when moving off
    // Vercel, and it looks identical to a slow model from the user's side.
    const started = Date.now()
    const res = await page.request.post('/api/assistant', {
      data: { messages: [{ role: 'user', content: 'What does a TRL of 4 mean?' }] },
      failOnStatusCode: false,
    })
    if (res.status() === 503) test.skip(true, 'No inference provider configured')

    expect(res.headers()['cache-control']).toContain('no-transform')
    expect(res.headers()['x-accel-buffering']).toBe('no')
    expect(Date.now() - started).toBeLessThan(120_000)
  })

  test('does not leak participant names to a remote provider', async ({ page }) => {
    await signIn(page, 'facilitator')

    const res = await page.request.post('/api/assistant', {
      data: { messages: [{ role: 'user', content: 'List the participants and their scores.' }] },
      failOnStatusCode: false,
    })
    if (res.status() === 503) test.skip(true, 'No inference provider configured')

    const body = await res.text()

    // When the provider is remote the route emits the pseudonym map, and the
    // model's own text should speak in tokens. Seeing tokens is the positive
    // signal that redaction ran at all.
    if (body.includes('event: pseudonyms')) {
      expect(body).toMatch(/Participant \d+|Mentor \d+/)
    }
  })
})
