/**
 * Ollama protocol translation, kept dependency-free so it can be tested.
 *
 * Ollama's chat API differs from Anthropic's in kind, not just in detail, and
 * every one of these differences is a place to get it wrong:
 *
 *   - tools are OpenAI-shaped: `{ type: 'function', function: { parameters } }`
 *   - tool calls carry NO id, so one must be synthesised
 *   - results go back as `{ role: 'tool', tool_name, content }`, matched by
 *     NAME rather than by Anthropic's `tool_use_id`
 *   - the system prompt is a message, not a top-level field
 *   - the response is newline-delimited JSON, not SSE
 */

export interface OllamaToolCall {
  function?: { name?: string; arguments?: Record<string, unknown> | string }
}

export interface OllamaChunk {
  message?: {
    role?: string
    content?: string
    tool_calls?: OllamaToolCall[]
  }
  done?: boolean
  done_reason?: string
  prompt_eval_count?: number
  eval_count?: number
}

export interface ProtocolToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type ProtocolMessage =
  | { role: 'user'; content: string }
  | {
      role: 'assistant'
      content: string
      toolCalls?: { id: string; name: string; input: Record<string, unknown> }[]
    }
  | { role: 'tool'; toolCallId: string; name: string; content: string }

export function toOllamaTools(tools: ProtocolToolDefinition[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }))
}

export function toOllamaMessages(
  system: string,
  messages: ProtocolMessage[]
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [{ role: 'system', content: system }]

  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content })
    } else if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: m.content ?? '',
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                function: { name: c.name, arguments: c.input },
              })),
            }
          : {}),
      })
    } else {
      // Matched to the call by tool NAME; Ollama has no call id.
      out.push({ role: 'tool', tool_name: m.name, content: m.content })
    }
  }

  return out
}

/**
 * Arguments arrive as an object from some models and as a JSON string from
 * others. A malformed string yields `{}` rather than throwing, so one bad tool
 * call cannot kill the stream.
 */
export function parseArgs(fn: OllamaToolCall['function']): Record<string, unknown> {
  const args = fn?.arguments
  if (!args) return {}
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args)
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  return args
}

/**
 * Incremental newline-delimited JSON parser.
 *
 * A network chunk can split a JSON object anywhere, so the trailing partial
 * line must be carried over rather than parsed. Getting this wrong drops the
 * final `done` frame, which is where token counts live.
 */
export function createNdjsonParser() {
  let buffer = ''

  return {
    /** Feed a decoded chunk, get back the complete objects it finished. */
    push(text: string): OllamaChunk[] {
      buffer += text
      const lines = buffer.split('\n')
      // The last element is either an empty string or a partial line.
      buffer = lines.pop() ?? ''

      const out: OllamaChunk[] = []
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          out.push(JSON.parse(trimmed) as OllamaChunk)
        } catch {
          // A malformed line is skipped rather than aborting the stream.
        }
      }
      return out
    },

    /** Flush anything left after the stream ends. */
    flush(): OllamaChunk[] {
      const trimmed = buffer.trim()
      buffer = ''
      if (!trimmed) return []
      try {
        return [JSON.parse(trimmed) as OllamaChunk]
      } catch {
        return []
      }
    },
  }
}
