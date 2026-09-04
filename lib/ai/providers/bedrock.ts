import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk'
import { DEFAULT_MODELS } from '@/lib/ai/models'
import { buildRequest, consumeAnthropicStream } from './anthropic-shared'
import {
  ProviderUnavailableError,
  type AssistantProvider,
  type StreamEvent,
  type TurnRequest,
} from './types'

/**
 * Amazon Bedrock.
 *
 * Uses the Mantle client (the Messages-API Bedrock endpoint), not the legacy
 * bedrock-runtime InvokeModel path.
 *
 * Credentials come from the AWS default provider chain, which on EC2 resolves
 * to the instance role. No static keys are read here on purpose: the S3 code
 * elsewhere in this app passes explicit keys and therefore cannot use an
 * instance role at all, and that is a mistake not worth repeating.
 *
 * Region note: af-south-1 serves Claude 4.5 only through GLOBAL cross-region
 * inference profiles, so requests are routed to whichever commercial region has
 * capacity. Prompt content therefore leaves South Africa, which is why
 * lib/ai/pseudonymise.ts exists.
 */
let client: AnthropicBedrockMantle | null = null

function getClient(): AnthropicBedrockMantle {
  const region = process.env.AWS_REGION ?? 'af-south-1'
  if (!client) client = new AnthropicBedrockMantle({ awsRegion: region })
  return client
}

export function createBedrockProvider(model?: string): AssistantProvider {
  const resolved = model ?? DEFAULT_MODELS.bedrock

  return {
    id: 'bedrock',
    model: resolved,
    isRemote: true,

    async *streamTurn(req: TurnRequest): AsyncIterable<StreamEvent> {
      const body = buildRequest(resolved, req)
      try {
        const stream = getClient().messages.stream(body as never)
        yield* consumeAnthropicStream(stream)
      } catch (err) {
        // Most commonly: no credentials on the instance, the account has not
        // enabled the af-south-1 opt-in region, or the inference profile id is
        // wrong. Confirm with: aws bedrock list-inference-profiles --region af-south-1
        throw new ProviderUnavailableError(
          `Bedrock request failed (model ${resolved}): ${
            err instanceof Error ? err.message : String(err)
          }`
        )
      }
    },
  }
}
