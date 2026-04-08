/**
 * Help Center Embedding Service
 *
 * Generates embeddings for knowledge base articles using Gemini text-embedding-004
 * via the OpenAI-compatible API (through Cloudflare AI Gateway).
 *
 * Uses a separate model from the post embedding service (768 dims vs 1536 dims)
 * to optimize for the smaller, more structured KB content.
 */

import { db, helpCenterArticles, eq, sql } from '@/lib/server/db'
import { getOpenAI } from '@/lib/server/domains/ai/config'
import { withRetry } from '@/lib/server/domains/ai/retry'
import type { HelpCenterArticleId } from '@quackback/ids'

export const KB_EMBEDDING_MODEL = 'google/text-embedding-004'
const KB_EMBEDDING_DIMENSIONS = 768

/**
 * Format article text for embedding input.
 *
 * Title is repeated twice for emphasis (higher weight in similarity).
 * Category name is appended as context when available.
 * Total output is truncated to 8000 chars to avoid token limits.
 */
export function formatArticleText(title: string, content: string, categoryName?: string): string {
  const parts = [title, title, content || '']
  if (categoryName) parts.push(`Category: ${categoryName}`)
  return parts.join('\n\n').slice(0, 8000)
}

/**
 * Generate embedding for text using Gemini text-embedding-004.
 */
export async function generateKbEmbedding(text: string): Promise<number[] | null> {
  const openai = getOpenAI()
  if (!openai) return null

  try {
    const { result: response } = await withRetry(() =>
      openai.embeddings.create({
        model: KB_EMBEDDING_MODEL,
        input: text,
        dimensions: KB_EMBEDDING_DIMENSIONS,
      })
    )
    return response.data[0]?.embedding ?? null
  } catch (error) {
    console.error('[KB Embedding] Gemini embedding failed:', error)
    return null
  }
}

/**
 * Generate embedding for an article and save it to the database.
 */
export async function generateArticleEmbedding(
  articleId: string,
  title: string,
  content: string,
  categoryName?: string
): Promise<boolean> {
  const text = formatArticleText(title, content, categoryName)
  const embedding = await generateKbEmbedding(text)
  if (!embedding) return false

  const vectorStr = `[${embedding.join(',')}]`
  await db
    .update(helpCenterArticles)
    .set({
      embedding: sql`${vectorStr}::vector`,
      embeddingModel: KB_EMBEDDING_MODEL,
      embeddingUpdatedAt: new Date(),
    })
    .where(eq(helpCenterArticles.id, articleId as HelpCenterArticleId))

  return true
}
