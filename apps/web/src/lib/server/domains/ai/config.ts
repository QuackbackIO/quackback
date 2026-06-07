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

/** Strip markdown code fences that some models wrap around JSON responses. */
export function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '')
}
