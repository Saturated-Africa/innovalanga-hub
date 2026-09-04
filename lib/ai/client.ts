import Anthropic from '@anthropic-ai/sdk'

/**
 * Anthropic client.
 *
 * Constructed lazily, following the `lib/email.ts` precedent: the AWS clients
 * in this codebase are built at module scope, which means a missing key breaks
 * the build rather than the one request that needed it. The assistant is an
 * additive feature, so a deployment without `ANTHROPIC_API_KEY` should keep
 * working with the assistant disabled.
 */
let client: Anthropic | null = null

export function getAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set')
  }
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return client
}

/** Whether the assistant should be offered at all. */
export function isAssistantEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

export const ASSISTANT_MODEL = 'claude-opus-5'

/**
 * Answers are short and conversational, and the route streams, so a generous
 * ceiling costs nothing when unused but avoids truncating a long report draft.
 */
export const ASSISTANT_MAX_TOKENS = 8000
