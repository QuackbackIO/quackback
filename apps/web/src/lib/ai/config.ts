/**
 * AI configuration and client management.
 *
 * Uses OpenAI for embeddings and sentiment analysis.
 * Routes through Cloudflare AI Gateway when OPENAI_BASE_URL is configured.
 */

import OpenAI from 'openai'

let openai: OpenAI | null = null

/**
 * Get OpenAI client. Routes through Cloudflare AI Gateway if configured.
 */
export function getOpenAI(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null
  if (!openai) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL, // Cloudflare gateway or undefined for direct
    })
  }
  return openai
}

/**
 * Check if AI features are enabled (OpenAI API key is configured).
 */
export function isAIEnabled(): boolean {
  return !!process.env.OPENAI_API_KEY
}
