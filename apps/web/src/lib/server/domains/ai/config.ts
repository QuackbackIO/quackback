/**
 * AI configuration and client management.
 *
 * One provider is active at a time (see ./provider): an OpenAI-compatible
 * endpoint declared via OPENAI_API_KEY + OPENAI_BASE_URL, or the Claude API via
 * ANTHROPIC_API_KEY. AI is off when neither is set and when both are; each
 * feature additionally requires a configured model (see ./models).
 */

import OpenAI from 'openai'
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import {
  AI_CONFIG_ISSUE_MESSAGES,
  defaultChatModelFor,
  getAiProvider,
  resolveAiProvider,
  type AiProviderEnv,
} from './provider'

const log = logger.child({ component: 'ai-config' })

/**
 * Deliberately process-wide, not per-workspace.
 *
 * The client is constructed from the API key and base URL alone, both of which
 * come from the environment; no workspace value reaches it, and no request
 * attaches per-caller headers to it. Partitioning it would open one upstream
 * connection pool per workspace for a client every workspace would configure
 * identically. Whether a workspace may use AI at all is a separate decision
 * belonging to the caller, not to whether a client object exists.
 */
let openai: OpenAI | null = null

/**
 * Whether chat AI can run: exactly one provider is configured (see
 * ./provider). There is no implicit provider default (see #180).
 */
export function isAiClientConfigured(): boolean {
  return getAiProvider() !== null
}

/**
 * The OpenAI-compatible client, or `null` when that provider is not the active
 * one. Only embeddings use it directly; chat goes through ./chat-adapter.
 * Callers handle `null` by returning early or falling back to a non-AI path.
 */
export function getOpenAI(): OpenAI | null {
  if (getAiProvider() !== 'openai') return null
  if (!openai) {
    openai = new OpenAI({
      apiKey: config.openaiApiKey,
      baseURL: config.openaiBaseUrl,
    })
  }
  return openai
}

interface AiConfigSnapshot extends AiProviderEnv {
  chatModel: string | undefined
  embeddingModel: string | undefined
  /** Every per-feature model variable that is set, for the provider-shape check. */
  featureModels?: string[]
}

/**
 * Pure check for misconfigured AI: returns human-readable warnings.
 * Silent when AI is fully off (nothing set) or correctly configured.
 */
export function collectAiConfigWarnings(snap: AiConfigSnapshot): string[] {
  const warnings: string[] = []
  const { provider, issue } = resolveAiProvider(snap)
  if (issue) warnings.push(AI_CONFIG_ISSUE_MESSAGES[issue])
  if (!provider) return warnings

  // Note: this checks role defaults only; a config that sets just a per-feature
  // override (e.g. AI_SUMMARY_MODEL) without a role default will still log this,
  // even though that one feature is enabled. Logs-only, so acceptable.
  const chatDefault = snap.chatModel ?? defaultChatModelFor(provider)
  if (provider === 'openai' && !chatDefault && !snap.embeddingModel) {
    warnings.push(
      'AI endpoint configured but no models set; all AI features are disabled. Set AI_CHAT_MODEL and/or AI_EMBEDDING_MODEL.'
    )
  }
  if (provider === 'anthropic') {
    // OpenRouter-style ids ("anthropic/claude-haiku-5.5") are not Claude API ids.
    const gatewayIds = [snap.chatModel, ...(snap.featureModels ?? [])].filter((m): m is string =>
      Boolean(m && m.includes('/'))
    )
    if (gatewayIds.length > 0) {
      warnings.push(
        `ANTHROPIC_API_KEY is the active provider but some AI_*_MODEL values look like gateway model ids (${[...new Set(gatewayIds)].join(', ')}). Use Claude API ids such as claude-haiku-5-5, or unset them to use the default.`
      )
    }
    warnings.push(
      'Embeddings are unavailable on the Claude API: help center, assistant and post search use keyword matching, similar-post and merge suggestions are off, and AI_EMBEDDING_MODEL is ignored.'
    )
  }
  return warnings
}

/** Log AI config warnings once at boot. Never throws. */
export function validateAiConfig(): void {
  const warnings = collectAiConfigWarnings({
    openaiApiKey: config.openaiApiKey,
    openaiBaseUrl: config.openaiBaseUrl,
    anthropicApiKey: config.anthropicApiKey,
    chatModel: config.aiChatModel,
    embeddingModel: config.aiEmbeddingModel,
    featureModels: [
      config.aiSummaryModel,
      config.aiSentimentModel,
      config.aiExtractionModel,
      config.aiQualityGateModel,
      config.aiInterpretationModel,
      config.aiMergeModel,
      config.aiHelpCenterModel,
      config.aiHelpCenterTranslateModel,
      config.aiAssistantModel,
      config.aiDesignModel,
      config.aiInboxTranslationModel,
      config.aiClassificationModel,
    ].filter((m): m is string => Boolean(m)),
  })
  for (const w of warnings) log.warn({ warning: w }, 'ai config warning')
  const provider = getAiProvider()
  if (provider) log.info({ ai_provider: provider }, 'ai provider active')
}

/** Strip markdown code fences that some models wrap around JSON responses. */
export function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '')
}

/**
 * Extra request-body options that keep a strict structured-output request
 * (`response_format: json_schema`) reliable when the endpoint is OpenRouter.
 * OpenRouter fans a single model out across many upstream providers, only some
 * of which enforce the schema; the rest accept the parameter but may answer in
 * free-form prose, so the structured request silently degrades and fails to
 * parse. `require_parameters` restricts routing to providers that support every
 * parameter in the request, the schema included. Returns nothing for any other
 * endpoint, where a direct provider, gateway, or local server would reject or
 * ignore an unknown `provider` field.
 *
 * Caveat: `require_parameters` gates on EVERY request parameter, so each must be
 * one the upstream providers advertise. Cap output with `max_tokens`, not
 * `max_completion_tokens` — no OpenRouter provider lists the latter, so pairing
 * it with this option routes to zero endpoints (a 404 "no endpoints found").
 *
 * `AI_REQUIRE_PARAMETERS=false` disables the gate. Escape hatch for models
 * whose providers don't advertise `response_format` at all — with the gate on,
 * every structured request to such a model 404s; with it off, the request goes
 * through unconstrained and output quality rests on prompt hardening and the
 * salvage parsers. Leave unset unless a model has no schema-capable provider.
 */
export function structuredOutputProviderOptions(): {
  provider?: { require_parameters: true }
} {
  return isOpenRouter() && config.aiRequireParameters !== false
    ? { provider: { require_parameters: true } }
    : {}
}

/**
 * Hide reasoning tokens on the OpenRouter wire.
 *
 * Same shape as {@link structuredOutputProviderOptions}: an explicit boolean
 * on an OpenRouter-only extra. Unset is off — `require_parameters` 404s
 * models whose providers do not advertise `reasoning` (GLM 5.3 Flash). Set
 * `AI_REASONING_EXCLUDE=true` for reasoning models such as DeepSeek v4 Flash,
 * whose json_schema streams otherwise prefix thinking as whitespace and kill
 * Ask AI. Callers that must round-trip `reasoning_details` (Quinn's tool loop)
 * should skip this helper.
 */
export function reasoningExcludeProviderOptions(): { reasoning?: { exclude: true } } {
  return isOpenRouter() && config.aiReasoningExclude === true
    ? { reasoning: { exclude: true } }
    : {}
}

/**
 * OpenRouter extras apply only while the OpenAI-compatible endpoint is the
 * active provider; on the Claude API they would be unknown request fields.
 */
function isOpenRouter(): boolean {
  return getAiProvider() !== 'anthropic' && Boolean(config.openaiBaseUrl?.includes('openrouter.ai'))
}

const REASONING_EFFORTS = new Set(['low', 'high', 'max', 'medium', 'minimal'])

/**
 * OpenRouter `reasoning.effort` for models that cannot disable thinking.
 * Unset leaves the provider default.
 */
export function reasoningEffortProviderOptions(): { reasoning?: { effort: string } } {
  const effort = config.aiReasoningEffort?.trim().toLowerCase()
  if (!effort || !REASONING_EFFORTS.has(effort) || !isOpenRouter()) return {}
  return { reasoning: { effort } }
}
