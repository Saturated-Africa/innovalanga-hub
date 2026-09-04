/**
 * The provider-neutral shape the assistant speaks.
 *
 * Two of the three providers are Anthropic-native, so it would be tempting to
 * use Anthropic's message types as the internal format. That breaks down on
 * Ollama, whose tool protocol differs in kind rather than in detail: it returns
 * `message.tool_calls` with no call id, and expects results back as
 * `{ role: 'tool', tool_name, content }` rather than Anthropic's
 * `tool_result` block carrying a `tool_use_id`.
 *
 * So the canonical form is defined here and each adapter translates at its own
 * edge. The route, the tool layer and the pseudonymiser only ever see this.
 */

export type ProviderId = 'anthropic' | 'bedrock' | 'ollama'

export interface ToolCall {
  /** Synthesised for providers that do not supply one (Ollama). */
  id: string
  name: string
  input: Record<string, unknown>
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string }

export interface ToolDefinition {
  name: string
  description: string
  /** JSON Schema for the arguments. */
  inputSchema: Record<string, unknown>
}

export interface TurnRequest {
  system: string
  messages: ChatMessage[]
  tools: ToolDefinition[]
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheRead: number
  cacheWrite: number
}

export type StreamEvent =
  /** Incremental visible text. */
  | { type: 'text'; text: string }
  /** The model wants a tool run. Emitted once the arguments are complete. */
  | { type: 'tool_call'; call: ToolCall }
  /** Terminal. `stopReason` is 'tool_use' when tools were requested. */
  | { type: 'done'; stopReason: string; usage: TokenUsage }

export interface AssistantProvider {
  readonly id: ProviderId
  readonly model: string
  /**
   * Whether prompts leave our infrastructure.
   *
   * Drives pseudonymisation: true for Bedrock and the first-party API, false
   * for Ollama running inside the VPC. This is the flag that decides whether
   * participant names cross a border.
   */
  readonly isRemote: boolean

  streamTurn(req: TurnRequest): AsyncIterable<StreamEvent>
}

/** Thrown when a provider is selected but not usable. Surfaced as a 503. */
export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderUnavailableError'
  }
}
