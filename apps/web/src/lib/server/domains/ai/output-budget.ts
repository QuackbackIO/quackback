/**
 * How a chat request caps its output, chosen for the endpoint it goes to.
 *
 * Endpoints disagree on the field name:
 *
 *  - OpenAI's own API rejects `max_tokens` for its reasoning models (the GPT-5
 *    family and later) with a 400 and asks for `max_completion_tokens`. Its
 *    older models accept either, so `max_completion_tokens` is safe there for
 *    every model.
 *  - OpenRouter needs `max_tokens`: no OpenRouter provider advertises
 *    `max_completion_tokens`, so with `require_parameters` on (see
 *    `structuredOutputProviderOptions`) the request routes to zero endpoints.
 *  - Gateways and local servers vary, and self-hosters run ones we never see,
 *    so anything else keeps `max_tokens`, the field they have always received.
 *
 * `AI_MAX_TOKENS_PARAM` (`max_tokens` or `max_completion_tokens`) overrides the
 * choice, for example for a gateway or Azure deployment in front of OpenAI's
 * reasoning models.
 *
 * Lives outside `./config` on purpose: service tests mock that module with a
 * bare factory, and this helper must keep working under those mocks.
 */
import { config } from '@/lib/server/config'

type TokenParam = 'max_tokens' | 'max_completion_tokens'

/**
 * Extra room added to the cap when it is sent as `max_completion_tokens`.
 * That field also counts a reasoning model's hidden thinking, so a cap sized
 * for the visible answer (the spam filter asks for 100) can be spent on
 * thinking alone and come back empty with `finish_reason: "length"`. A model
 * that does not reason stops when its answer is done, so for it this is only a
 * higher ceiling, never extra spend.
 */
export const REASONING_HEADROOM_TOKENS = 8_000

/** The `reasoning_effort` values OpenAI's Chat Completions API accepts. */
const OPENAI_REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])

function isOpenAiApi(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false
  try {
    return new URL(baseUrl).hostname === 'api.openai.com'
  } catch {
    return false
  }
}

/** The field this endpoint takes for the output cap. */
export function outputTokenParam(): TokenParam {
  const override = config.aiMaxTokensParam?.trim().toLowerCase()
  if (override === 'max_tokens' || override === 'max_completion_tokens') return override
  return isOpenAiApi(config.openaiBaseUrl) ? 'max_completion_tokens' : 'max_tokens'
}

/**
 * Request-body options that cap a reply at `maxTokens` visible tokens.
 *
 * With `max_completion_tokens` the cap gets {@link REASONING_HEADROOM_TOKENS}
 * on top, and `AI_REASONING_EFFORT`, when set to a value OpenAI accepts, is
 * sent as a top-level `reasoning_effort`. It is never sent unasked: models
 * that do not reason reject it. (OpenRouter takes effort as
 * `reasoning.effort` instead; see `reasoningEffortProviderOptions`.)
 */
export function outputBudgetOptions(
  maxTokens: number
): { max_tokens: number } | { max_completion_tokens: number; reasoning_effort?: string } {
  if (outputTokenParam() === 'max_tokens') return { max_tokens: maxTokens }
  const effort = config.aiReasoningEffort?.trim().toLowerCase()
  return {
    max_completion_tokens: maxTokens + REASONING_HEADROOM_TOKENS,
    ...(effort && OPENAI_REASONING_EFFORTS.has(effort) ? { reasoning_effort: effort } : {}),
  }
}
