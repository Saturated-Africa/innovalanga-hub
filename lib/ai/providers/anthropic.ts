import Anthropic from '@anthropic-ai/sdk'
import { DEFAULT_MODELS } from '@/lib/ai/models'
import { buildRequest, consumeAnthropicStream } from './anthropic-shared'
import {
  ProviderUnavailableError,
  type AssistantProvider,
  type StreamEvent,
  type TurnRequest,
} from './types'

/**
 * First-party Claude API.
 *
 * Constructed lazily so a deployment without ANTHROPIC_API_KEY still builds and
 * runs with the assistant disabled, rather than failing at import time.
 */
let client: Anthropic | null = null

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ProviderUnavailableError('ANTHROPIC_API_KEY is not set.')
  }
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return client
}

export function createAnthropicProvider(model?: string): AssistantProvider {
  const resolved = model ?? DEFAULT_MODELS.anthropic

  return {
    id: 'anthropic',
    model: resolved,
    isRemote: true,

    async *streamTurn(req: TurnRequest): AsyncIterable<StreamEvent> {
      const body = buildRequest(resolved, req)
      const stream = getClient().messages.stream(body as never)
      yield* consumeAnthropicStream(stream)
    },
  }
}

export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}
