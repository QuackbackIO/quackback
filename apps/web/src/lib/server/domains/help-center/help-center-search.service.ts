/**
 * Help Center Hybrid Search Service
 *
 * Combines tsvector keyword search with pgvector semantic search
 * for improved article discovery. Falls back to keyword-only search
 * when embedding generation is unavailable.
 */

import {
  db,
  helpCenterArticles,
  helpCenterCategories,
  and,
  isNull,
  isNotNull,
  sql,
} from '@/lib/server/db'
import { generateKbEmbedding } from './help-center-embedding.service'

const KEYWORD_WEIGHT = 0.4
const SEMANTIC_WEIGHT = 0.6

export interface HybridSearchResult {
  id: string
  slug: string
  title: string
  description: string | null
  content: string
  categoryId: string
  categorySlug: string
  categoryName: string
  score: number
}

/**
 * Combine keyword and semantic search scores.
 *
 * When both scores are available, applies weighted combination (0.4 keyword + 0.6 semantic).
 * When only one score is available, returns that score directly.
 * Returns 0 when both are null.
 */
export function computeHybridScore(
  keywordScore: number | null,
  semanticScore: number | null
): number {
  if (keywordScore != null && semanticScore != null) {
    return KEYWORD_WEIGHT * keywordScore + SEMANTIC_WEIGHT * semanticScore
  }
  if (keywordScore != null) return keywordScore
  if (semanticScore != null) return semanticScore
  return 0
}

/**
 * Execute hybrid search combining keyword and semantic matching.
 *
 * 1. Generates a query embedding via Gemini (may return null if AI is unavailable)
 * 2. If embedding is available: runs a hybrid query combining tsvector + pgvector
 * 3. If embedding is unavailable: falls back to keyword-only search
 */
export async function hybridSearch(query: string, limit = 10): Promise<HybridSearchResult[]> {
  const queryEmbedding = await generateKbEmbedding(query)

  if (queryEmbedding) {
    return hybridQuery(query, queryEmbedding, limit)
  }

  return keywordOnlyQuery(query, limit)
}

/**
 * Hybrid query: combines tsvector keyword search with pgvector semantic similarity.
 */
async function hybridQuery(
  query: string,
  embedding: number[],
  limit: number
): Promise<HybridSearchResult[]> {
  const vectorStr = `[${embedding.join(',')}]`
  const tsQuery = sql`websearch_to_tsquery('english', ${query})`

  const results = await db
    .select({
      id: helpCenterArticles.id,
      slug: helpCenterArticles.slug,
      title: helpCenterArticles.title,
      description: helpCenterArticles.description,
      content: helpCenterArticles.content,
      categoryId: helpCenterArticles.categoryId,
      categorySlug: helpCenterCategories.slug,
      categoryName: helpCenterCategories.name,
      combinedScore: sql<number>`(
        ${KEYWORD_WEIGHT} * COALESCE(ts_rank(${helpCenterArticles.searchVector}, ${tsQuery}), 0) +
        ${SEMANTIC_WEIGHT} * COALESCE(1 - (${helpCenterArticles.embedding} <=> ${vectorStr}::vector), 0)
      )`.as('combined_score'),
    })
    .from(helpCenterArticles)
    .innerJoin(
      helpCenterCategories,
      sql`${helpCenterArticles.categoryId} = ${helpCenterCategories.id}`
    )
    .where(
      and(
        isNotNull(helpCenterArticles.publishedAt),
        isNull(helpCenterArticles.deletedAt),
        isNull(helpCenterCategories.deletedAt),
        sql`(
          ${helpCenterArticles.searchVector} @@ ${tsQuery}
          OR (
            ${helpCenterArticles.embedding} IS NOT NULL
            AND 1 - (${helpCenterArticles.embedding} <=> ${vectorStr}::vector) > 0.5
          )
        )`
      )
    )
    .orderBy(sql`combined_score DESC`)
    .limit(limit)

  return results.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    content: r.content,
    categoryId: r.categoryId,
    categorySlug: r.categorySlug,
    categoryName: r.categoryName,
    score: Number(r.combinedScore),
  }))
}

/**
 * Keyword-only fallback when embedding generation is unavailable.
 */
async function keywordOnlyQuery(query: string, limit: number): Promise<HybridSearchResult[]> {
  const tsQuery = sql`websearch_to_tsquery('english', ${query})`

  const results = await db
    .select({
      id: helpCenterArticles.id,
      slug: helpCenterArticles.slug,
      title: helpCenterArticles.title,
      description: helpCenterArticles.description,
      content: helpCenterArticles.content,
      categoryId: helpCenterArticles.categoryId,
      categorySlug: helpCenterCategories.slug,
      categoryName: helpCenterCategories.name,
      score: sql<number>`ts_rank(${helpCenterArticles.searchVector}, ${tsQuery})`.as('score'),
    })
    .from(helpCenterArticles)
    .innerJoin(
      helpCenterCategories,
      sql`${helpCenterArticles.categoryId} = ${helpCenterCategories.id}`
    )
    .where(
      and(
        isNotNull(helpCenterArticles.publishedAt),
        isNull(helpCenterArticles.deletedAt),
        isNull(helpCenterCategories.deletedAt),
        sql`${helpCenterArticles.searchVector} @@ ${tsQuery}`
      )
    )
    .orderBy(sql`score DESC`)
    .limit(limit)

  return results.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    content: r.content,
    categoryId: r.categoryId,
    categorySlug: r.categorySlug,
    categoryName: r.categoryName,
    score: Number(r.score),
  }))
}
