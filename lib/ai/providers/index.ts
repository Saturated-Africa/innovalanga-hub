import { createAnthropicProvider, isAnthropicConfigured } from './anthropic'
import { createBedrockProvider } from './bedrock'
import { createOllamaProvider, isOllamaConfigured } from './ollama'
import { ProviderUnavailableError, type AssistantProvider, type ProviderId } from './types'

export * from './types'

/**
 * Provider selection.
 *
 * `AI_PROVIDER` picks the backend:
 *
 *   bedrock    Amazon Bedrock via the instance role. The production default.
 *   ollama     Self-hosted, inside the VPC. Prompts never leave.
 *   anthropic  First-party Claude API. Useful for local development.
 *
 * Unset disables the assistant entirely: the launcher is hidden and the route
 * returns 503. That is deliberate — an assistant that half-works is worse than
 * one that is visibly off.
 */
function selectedProvider(): ProviderId | null {
  const raw = process.env.AI_PROVIDER?.trim().toLowerCase()
  if (raw === 'bedrock' || raw === 'ollama' || raw === 'anthropic') return raw
  if (raw) return null

  // No explicit choice: fall back to the first-party API if a key happens to be
  // present, so local development works without extra configuration.
  return isAnthropicConfigured() ? 'anthropic' : null
}

/** Whether the assistant should be offered at all. */
export function isAssistantEnabled(): boolean {
  const provider = selectedProvider()
  if (!provider) return false
  if (provider === 'anthropic') return isAnthropicConfigured()
  if (provider === 'ollama') return isOllamaConfigured()
  // Bedrock credentials come from the instance role, which cannot be checked
  // synchronously here; assume configured and let the request fail loudly.
  return true
}

export function getProvider(): AssistantProvider {
  const provider = selectedProvider()
  const model = process.env.AI_MODEL?.trim() || undefined

  switch (provider) {
    case 'bedrock':
      return createBedrockProvider(model)
    case 'ollama':
      return createOllamaProvider(model)
    case 'anthropic':
      return createAnthropicProvider(model)
    default:
      throw new ProviderUnavailableError(
        'No inference provider is configured. Set AI_PROVIDER to bedrock, ollama or anthropic.'
      )
  }
}
