import { randomUUID } from 'node:crypto'
import { DEFAULT_MODELS, ASSISTANT_MAX_TOKENS } from '@/lib/ai/models'
import {
  createNdjsonParser,
  parseArgs,
  toOllamaMessages,
  toOllamaTools,
} from './ollama-protocol'
import {
  ProviderUnavailableError,
  type AssistantProvider,
  type ChatMessage,
  type StreamEvent,
  type ToolDefinition,
  type TurnRequest,
} from './types'

/**
 * Self-hosted Ollama.
 *
 * Written and tested but not deployed: on af-south-1 the largest GPU available
 * is G4dn (T4, 16 GB), G5/G6 are not offered there, and a GPU instance costs
 * roughly 15x the Bedrock spend at this volume. The adapter exists so the
 * self-hosted path is a configuration change rather than a project.
 *
 * The compelling reason to switch it on is data residency: `isRemote` is false,
 * so pseudonymisation becomes a no-op and real participant names never leave
 * the VPC.
 *
 * Protocol differences from Anthropic that this adapter absorbs:
 *   - tools are OpenAI-shaped (`{ type: 'function', function: {...} }`)
 *   - tool calls carry NO id, so one is synthesised to keep our canonical shape
 *   - results go back as `{ role: 'tool', tool_name, content }`, not as a
 *     `tool_result` block referencing a `tool_use_id`
 *   - the system prompt is a message with `role: 'system'`, not a top-level field
 */

/** Defaults to a local daemon; in AWS this points at the private GPU host. */
function baseUrl(): string {
  return (process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '')
}

export function createOllamaProvider(model?: string): AssistantProvider {
  const resolved = model ?? process.env.AI_MODEL ?? DEFAULT_MODELS.ollama

  return {
    id: 'ollama',
    model: resolved,
    // Runs inside our own network, so prompts never cross a border.
    isRemote: false,

    async *streamTurn(req: TurnRequest): AsyncIterable<StreamEvent> {
      let res: Response
      try {
        res = await fetch(`${baseUrl()}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: resolved,
            stream: true,
            messages: toOllamaMessages(req.system, req.messages),
            tools: toOllamaTools(req.tools),
            options: { num_predict: ASSISTANT_MAX_TOKENS },
          }),
        })
      } catch (err) {
        throw new ProviderUnavailableError(
          `Could not reach Ollama at ${baseUrl()}: ${
            err instanceof Error ? err.message : String(err)
          }`
        )
      }

      if (!res.ok || !res.body) {
        throw new ProviderUnavailableError(
          `Ollama returned ${res.status} for model ${resolved}. Is the model pulled?`
        )
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      const parser = createNdjsonParser()
      let stopReason = 'end_turn'
      let inputTokens = 0
      let outputTokens = 0
      const calls: StreamEvent[] = []

      const handle = (chunk: ReturnType<typeof parser.flush>[number]) => {
        const text = chunk.message?.content
        if (text) pending.push({ type: 'text', text })

        for (const call of chunk.message?.tool_calls ?? []) {
          const name = call.function?.name
          if (!name) continue
          calls.push({
            type: 'tool_call',
            call: { id: `ollama_${randomUUID()}`, name, input: parseArgs(call.function) },
          })
        }

        if (chunk.done) {
          inputTokens = chunk.prompt_eval_count ?? 0
          outputTokens = chunk.eval_count ?? 0
          stopReason = calls.length ? 'tool_use' : chunk.done_reason ?? 'end_turn'
        }
      }

      let pending: StreamEvent[] = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        for (const chunk of parser.push(decoder.decode(value, { stream: true }))) {
          handle(chunk)
        }
        for (const ev of pending) yield ev
        pending = []
      }

      for (const chunk of parser.flush()) handle(chunk)
      for (const ev of pending) yield ev

      for (const call of calls) yield call

      yield {
        type: 'done',
        stopReason,
        // Ollama has no prompt cache, so these are always zero.
        usage: { inputTokens, outputTokens, cacheRead: 0, cacheWrite: 0 },
      }
    },
  }
}

export function isOllamaConfigured(): boolean {
  return Boolean(process.env.OLLAMA_BASE_URL)
}
