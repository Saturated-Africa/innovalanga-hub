import type Anthropic from '@anthropic-ai/sdk'
import { profileFor, ASSISTANT_MAX_TOKENS } from '@/lib/ai/models'
import type {
  ChatMessage,
  StreamEvent,
  ToolDefinition,
  TurnRequest,
} from './types'

/**
 * Shared translation between our canonical shape and the Anthropic Messages
 * API. Used by both the first-party client and the Bedrock client, which expose
 * the same `messages.stream` surface.
 */

export function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
  }))
}

/**
 * Collapse our flat message list into Anthropic's block structure.
 *
 * Anthropic requires every `tool_result` for a turn to arrive in a SINGLE user
 * message — splitting them across messages trains the model to stop making
 * parallel calls — so consecutive `tool` messages are merged here.
 */
export function toAnthropicMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = []
  let pendingResults: Anthropic.ToolResultBlockParam[] = []

  const flush = () => {
    if (pendingResults.length) {
      out.push({ role: 'user', content: pendingResults })
      pendingResults = []
    }
  }

  for (const m of messages) {
    if (m.role === 'tool') {
      pendingResults.push({
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: m.content,
      })
      continue
    }

    flush()

    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content })
      continue
    }

    const blocks: Anthropic.ContentBlockParam[] = []
    if (m.content) blocks.push({ type: 'text', text: m.content })
    for (const call of m.toolCalls ?? []) {
      blocks.push({
        type: 'tool_use',
        id: call.id,
        name: call.name,
        input: call.input,
      })
    }
    out.push({ role: 'assistant', content: blocks.length ? blocks : m.content })
  }

  flush()
  return out
}

/**
 * Build the request body, honouring the model's capability profile.
 *
 * This is where the Haiku 4.5 trap is handled: `thinking: { type: 'adaptive' }`
 * is a 400 on the 4.5 generation, and `output_config.effort` errors there too.
 */
export function buildRequest(
  model: string,
  req: TurnRequest
): Record<string, unknown> {
  const profile = profileFor(model)

  const body: Record<string, unknown> = {
    model,
    max_tokens: ASSISTANT_MAX_TOKENS,
    system: profile.supportsCaching
      ? [
          {
            type: 'text',
            text: req.system,
            // The system prompt is stable per role, so it caches; the
            // conversation after it is the volatile part.
            cache_control: { type: 'ephemeral' },
          },
        ]
      : req.system,
    tools: toAnthropicTools(req.tools),
    messages: toAnthropicMessages(req.messages),
  }

  if (profile.thinking === 'adaptive') {
    body.thinking = { type: 'adaptive' }
  } else if (profile.thinking === 'legacy') {
    body.thinking = { type: 'enabled', budget_tokens: profile.thinkingBudget ?? 2048 }
  }
  // 'none' omits the parameter entirely, which is what the 4.5 generation wants.

  return body
}

/**
 * Drive an Anthropic-shaped stream and yield canonical events.
 *
 * Iterates the raw event stream rather than awaiting `finalMessage()` first —
 * awaiting the final message before yielding would buffer the whole answer and
 * silently turn a streaming assistant into a non-streaming one.
 *
 * `stream` is typed structurally because the first-party and Bedrock SDKs
 * expose identically shaped but nominally different types.
 */
export async function* consumeAnthropicStream(stream: {
  [Symbol.asyncIterator](): AsyncIterator<Anthropic.RawMessageStreamEvent>
  finalMessage(): Promise<Anthropic.Message>
}): AsyncGenerator<StreamEvent> {
  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta' &&
      event.delta.text
    ) {
      yield { type: 'text', text: event.delta.text }
    }
  }

  // Tool calls are read off the assembled message: their arguments arrive as
  // partial JSON deltas, so they are only reliable once the block is complete.
  const final = await stream.finalMessage()

  for (const block of final.content) {
    if (block.type === 'tool_use') {
      yield {
        type: 'tool_call',
        call: {
          id: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        },
      }
    }
  }

  yield {
    type: 'done',
    stopReason: final.stop_reason ?? 'end_turn',
    usage: {
      inputTokens: final.usage.input_tokens ?? 0,
      outputTokens: final.usage.output_tokens ?? 0,
      cacheRead: final.usage.cache_read_input_tokens ?? 0,
      cacheWrite: final.usage.cache_creation_input_tokens ?? 0,
    },
  }
}
