/**
 * Per-model capability profiles.
 *
 * The Claude API surface is not uniform across model generations, and getting
 * this wrong produces a 400 on the first request rather than a graceful
 * degradation. The specific trap this file exists to avoid:
 *
 *   - Opus 5 and the 4.6+ family take `thinking: { type: 'adaptive' }` and
 *     support `output_config.effort`.
 *   - Claude Haiku 4.5 and the rest of the 4.5 generation do NOT. They use the
 *     older `{ type: 'enabled', budget_tokens: N }` form and ERROR on `effort`.
 *
 * The assistant's cheap Bedrock path is Haiku 4.5, so hardcoding adaptive
 * thinking (as the first implementation did) would have failed every request.
 */

export type ThinkingMode =
  /** `{ type: 'adaptive' }` — Opus 5, Opus 4.6+, Sonnet 5. */
  | 'adaptive'
  /** `{ type: 'enabled', budget_tokens: N }` — 4.5 generation. */
  | 'legacy'
  /** Omit the parameter entirely. */
  | 'none'

export interface ModelProfile {
  /** Provider-specific model or inference-profile identifier. */
  id: string
  thinking: ThinkingMode
  /** `output_config.effort` errors on the 4.5 generation. */
  supportsEffort: boolean
  /** Prompt caching via `cache_control`. */
  supportsCaching: boolean
  /** Only meaningful when thinking is 'legacy'. Must be < max_tokens. */
  thinkingBudget?: number
}

/**
 * Resolve a profile from a model identifier.
 *
 * Matching is on substring rather than exact equality because Bedrock ids carry
 * a routing prefix and a version suffix — `global.anthropic.claude-haiku-4-5-20251001-v1:0`
 * is the same model as `claude-haiku-4-5`.
 */
export function profileFor(modelId: string): ModelProfile {
  const id = modelId.toLowerCase()

  // 4.5 generation: no adaptive thinking, no effort.
  if (
    id.includes('haiku-4-5') ||
    id.includes('sonnet-4-5') ||
    id.includes('opus-4-5')
  ) {
    return {
      id: modelId,
      // This assistant answers short questions over tool results; thinking
      // buys little and costs tokens. Omitting it is both correct and cheapest.
      thinking: 'none',
      // effort is accepted on Opus 4.5 but errors on Sonnet/Haiku 4.5. Off for
      // the whole generation rather than encoding a per-model exception.
      supportsEffort: false,
      supportsCaching: true,
    }
  }

  // Opus 5 / Opus 4.6-4.8 / Sonnet 5 / Fable: adaptive thinking is the on-mode.
  return {
    id: modelId,
    thinking: 'adaptive',
    supportsEffort: true,
    supportsCaching: true,
  }
}

/**
 * Default model per provider.
 *
 * Bedrock: af-south-1 serves Claude 4.5 only through GLOBAL cross-region
 * inference profiles. The exact identifier must be confirmed for the account
 * with:
 *
 *   aws bedrock list-inference-profiles --region af-south-1
 *
 * so it is overridable by `AI_MODEL` rather than being treated as settled.
 */
export const DEFAULT_MODELS = {
  anthropic: 'claude-opus-5',
  bedrock: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
  ollama: 'qwen3:8b',
} as const

/** Streaming, so a generous ceiling costs nothing when unused. */
export const ASSISTANT_MAX_TOKENS = 8000
