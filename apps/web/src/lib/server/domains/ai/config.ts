/**
 * AI configuration and client management.
 *
 * Uses OpenAI for embeddings and sentiment analysis.
 * Routes through Cloudflare AI Gateway when OPENAI_BASE_URL is configured.
 */

import OpenAI from 'openai'
import { config } from '@/lib/server/config'

let openai: OpenAI | null = null

/**
 * Get the OpenAI client instance, or `null` when AI is not configured.
 *
 * This is the single guard for all AI functionality. Callers should handle
 * `null` by returning early, falling back to a non-AI path, or throwing
 * `UnrecoverableError` (BullMQ workers).
 */
export function getOpenAI(): OpenAI | null {
  if (!config.openaiApiKey) return null
  if (!openai) {
    openai = new OpenAI({
      apiKey: config.openaiApiKey,
      baseURL: config.openaiBaseUrl, // Cloudflare gateway or undefined for direct
    })
  }
  return openai
}
