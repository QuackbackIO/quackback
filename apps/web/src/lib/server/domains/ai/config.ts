/**
 * AI configuration and client management.
 *
 * Talks to any OpenAI-compatible endpoint (direct provider, a model gateway,
 * or a local server) declared via OPENAI_BASE_URL. There is no implicit
 * endpoint default: AI is off unless both the API key and base URL are set,
 * and each feature additionally requires a configured model (see ./models).
 */

import OpenAI from 'openai'
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'ai-config' })

let openai: OpenAI | null = null

/**
 * Whether an AI client can be constructed. Requires BOTH an API key and an
 * explicit base URL — there is no implicit provider default (see #180).
 */
export function isAiClientConfigured(
  apiKey: string | undefined,
  baseUrl: string | undefined
): boolean {
  return Boolean(apiKey) && Boolean(baseUrl)
}

/**
 * Get the OpenAI-compatible client instance, or `null` when AI is not
 * configured. This is the single client guard for all AI functionality.
 * Callers handle `null` by returning early, falling back to a non-AI path,
 * or throwing `UnrecoverableError` (BullMQ workers).
 */
export function getOpenAI(): OpenAI | null {
  if (!isAiClientConfigured(config.openaiApiKey, config.openaiBaseUrl)) return null
  if (!openai) {
    openai = new OpenAI({
      apiKey: config.openaiApiKey,
      baseURL: config.openaiBaseUrl,
    })
  }
  return openai
}

interface AiConfigSnapshot {
  apiKey: string | undefined
  baseUrl: string | undefined
  chatModel: string | undefined
  embeddingModel: string | undefined
}

/**
 * Pure check for half-configured AI: returns human-readable warnings.
 * Silent when AI is fully off (nothing set) or correctly configured.
 */
export function collectAiConfigWarnings(snap: AiConfigSnapshot): string[] {
  const warnings: string[] = []
  // Key set but no endpoint → the client can't start; the old implicit
  // provider default is gone (see #180).
  if (snap.apiKey && !snap.baseUrl) {
    warnings.push(
      'AI disabled: OPENAI_API_KEY is set but OPENAI_BASE_URL is empty. Set OPENAI_BASE_URL to your provider or gateway endpoint.'
    )
  }
  // Note: this checks role defaults only; a config that sets just a per-feature
  // override (e.g. AI_SUMMARY_MODEL) without a role default will still log this,
  // even though that one feature is enabled. Logs-only, so acceptable.
  if (snap.apiKey && snap.baseUrl && !snap.chatModel && !snap.embeddingModel) {
    warnings.push(
      'AI endpoint configured but no models set; all AI features are disabled. Set AI_CHAT_MODEL and/or AI_EMBEDDING_MODEL.'
    )
  }
  return warnings
}

/** Log AI config warnings once at boot. Never throws. */
export function validateAiConfig(): void {
  const warnings = collectAiConfigWarnings({
    apiKey: config.openaiApiKey,
    baseUrl: config.openaiBaseUrl,
    chatModel: config.aiChatModel,
    embeddingModel: config.aiEmbeddingModel,
  })
  for (const w of warnings) log.warn({ warning: w }, 'ai config warning')
}

/** Strip markdown code fences that some models wrap around JSON responses. */
export function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '')
}
