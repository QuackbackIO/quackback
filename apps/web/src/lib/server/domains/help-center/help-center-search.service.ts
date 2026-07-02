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
  eq,
  isNull,
  isNotNull,
  lte,
  sql,
} from '@/lib/server/db'
import { generateKbEmbedding } from './help-center-embedding.service'

const KEYWORD_WEIGHT = 0.4
const SEMANTIC_WEIGHT = 0.6

/**
 * Cosine-similarity floor for semantic matches: rows below it are simply
 * absent from results. Shared with the assistant's retrieval module so
 * search and AI answers agree on what "relevant" means.
 */
export const SEMANTIC_SIMILARITY_FLOOR = 0.5

/** Which slice of the knowledge base a caller may see. */
export type HelpCenterAudience = 'public' | 'team'

/**
 * THE visibility predicate for help-center content, parameterized by
 * audience. `public` is the public help-center slice (published, not
 * scheduled-future, not deleted, category public and not deleted); `team`
 * keeps drafts and private categories but never soft-deleted rows.
 *
 * Every article query that joins helpCenterCategories must build its
 * predicate from this single owner: search, retrieval (AI answers), and
 * direct lookups must agree, or content hidden on one surface becomes
 * discoverable through another.
 */
export function helpCenterVisibilityConditions(audience: HelpCenterAudience) {
  const base = [isNull(helpCenterArticles.deletedAt), isNull(helpCenterCategories.deletedAt)]
  if (audience === 'team') return base
  return [
    ...base,
    isNotNull(helpCenterArticles.publishedAt),
    lte(helpCenterArticles.publishedAt, new Date()),
    eq(helpCenterCategories.isPublic, true),
  ]
}

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
  const queryEmbedding = await generateKbEmbedding(query, {
    pipelineStep: 'kb_search_query_embedding',
  })

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
        // Public slice via the shared owner (helpCenterVisibilityConditions):
        // search must match direct lookup or a hidden slug becomes
        // discoverable via search even when direct lookup denies.
        ...helpCenterVisibilityConditions('public'),
        sql`(
          ${helpCenterArticles.searchVector} @@ ${tsQuery}
          OR (
            ${helpCenterArticles.embedding} IS NOT NULL
            AND 1 - (${helpCenterArticles.embedding} <=> ${vectorStr}::vector) > ${SEMANTIC_SIMILARITY_FLOOR}
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

// ============================================================================
// Ranked id search (REST + MCP parity)
// ============================================================================

export interface RankedArticleSearchOptions {
  audience: HelpCenterAudience
  /** Size of the ranked pool. Callers paginate by slicing into it. */
  limit?: number
  categoryId?: string
  status?: 'draft' | 'published' | 'all'
}

/** Ranked pool size for list-search pagination. */
export const RANKED_SEARCH_POOL = 50

/**
 * Hybrid-ranked article ids for list search (REST articles list, MCP search).
 * Same scoring as hybridSearch, with a parameterized visibility predicate so
 * team surfaces keep their draft/private access. Falls back to keyword-only
 * ranking when embeddings are unavailable.
 */
export async function searchArticleIdsRanked(
  query: string,
  options: RankedArticleSearchOptions
): Promise<string[]> {
  const { audience, categoryId, status } = options
  const limit = options.limit ?? RANKED_SEARCH_POOL

  const conditions = helpCenterVisibilityConditions(audience)
  if (categoryId) {
    conditions.push(eq(helpCenterArticles.categoryId, categoryId as never))
  }
  // Public visibility already narrows to published; the status filter only
  // matters for team callers.
  if (audience === 'team') {
    if (status === 'published') {
      conditions.push(isNotNull(helpCenterArticles.publishedAt))
      conditions.push(lte(helpCenterArticles.publishedAt, new Date()))
    } else if (status === 'draft') {
      conditions.push(isNull(helpCenterArticles.publishedAt))
    }
  }

  const tsQuery = sql`websearch_to_tsquery('english', ${query})`
  const queryEmbedding = await generateKbEmbedding(query, {
    pipelineStep: 'kb_search_query_embedding',
  })

  let scoreExpr
  let matchCondition
  if (queryEmbedding) {
    const vectorStr = `[${queryEmbedding.join(',')}]`
    scoreExpr = sql<number>`(
      ${KEYWORD_WEIGHT} * COALESCE(ts_rank(${helpCenterArticles.searchVector}, ${tsQuery}), 0) +
      ${SEMANTIC_WEIGHT} * COALESCE(1 - (${helpCenterArticles.embedding} <=> ${vectorStr}::vector), 0)
    )`.as('rank_score')
    matchCondition = sql`(
      ${helpCenterArticles.searchVector} @@ ${tsQuery}
      OR (
        ${helpCenterArticles.embedding} IS NOT NULL
        AND 1 - (${helpCenterArticles.embedding} <=> ${vectorStr}::vector) > ${SEMANTIC_SIMILARITY_FLOOR}
      )
    )`
  } else {
    scoreExpr = sql<number>`ts_rank(${helpCenterArticles.searchVector}, ${tsQuery})`.as(
      'rank_score'
    )
    matchCondition = sql`${helpCenterArticles.searchVector} @@ ${tsQuery}`
  }

  const rows = await db
    .select({ id: helpCenterArticles.id, score: scoreExpr })
    .from(helpCenterArticles)
    .innerJoin(
      helpCenterCategories,
      sql`${helpCenterArticles.categoryId} = ${helpCenterCategories.id}`
    )
    .where(and(...conditions, matchCondition))
    .orderBy(sql`rank_score DESC`)
    .limit(limit)

  return rows.map((r) => r.id as string)
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
        ...helpCenterVisibilityConditions('public'),
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
