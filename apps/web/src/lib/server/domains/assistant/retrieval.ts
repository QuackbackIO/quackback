/**
 * Shared knowledge-base retrieval for AI answers.
 *
 * The single retrieval module behind help-center Ask AI (and, later, the
 * assistant's search_knowledge tool). Audience-scoped whole-article top-k:
 * semantic (pgvector cosine over kb_articles.embedding) when a query
 * embedding is available, keyword (tsvector) otherwise. Results below the
 * similarity floor are simply absent, so an empty result means "no relevant
 * articles" and callers must NOT invoke a model for it.
 *
 * Visibility comes from the help-center's shared predicate
 * (helpCenterVisibilityConditions), so private content can never become
 * discoverable through AI answers.
 */

import { db, helpCenterArticles, helpCenterCategories, and, sql } from '@/lib/server/db'
import { generateKbQueryEmbedding } from '@/lib/server/domains/help-center/help-center-embedding.service'
import {
  helpCenterVisibilityConditions,
  KEYWORD_WEIGHT,
  SEMANTIC_WEIGHT,
  SEMANTIC_SIMILARITY_FLOOR,
  KEYWORD_RANK_FLOOR,
  orTermsTsQuery,
  type HelpCenterAudience,
} from '@/lib/server/domains/help-center/help-center-search.service'

/**
 * A softer cosine floor for "related" near-misses. Below the answer floor, so
 * these articles are not good enough to answer from, but relevant enough to
 * suggest as next steps when Ask AI can't answer. Semantic path only.
 */
export const RELATED_SIMILARITY_FLOOR = 0.3

export interface RetrievedKbArticle {
  id: string
  slug: string
  title: string
  content: string
  categoryId: string
  categorySlug: string
  categoryName: string
  score: number
  /**
   * Whether this article would also clear the 'public' audience filter (a
   * public category, published, and not scheduled for the future). The
   * source-adapter boundary (retrieval-sources.ts) uses this to flag a
   * team-only row as internal for the copilot leak gate. Always true when
   * `audience: 'public'` was requested (the filter already guarantees it);
   * meaningful only on the wider 'team' query.
   */
  isPublic: boolean
}

export interface RetrieveKbArticlesOptions {
  audience?: HelpCenterAudience
  topK?: number
  /**
   * Minimum cosine similarity for the semantic path (default: the answer
   * floor). Lower it to surface "related" near-misses for suggestions.
   * Ignored on the keyword fallback, whose ts_rank scale is unrelated.
   */
  minScore?: number
  /**
   * Minimum ts_rank for the keyword path (default {@link KEYWORD_RANK_FLOOR}).
   * Keyword matching is OR-of-terms, so a single incidental term keeps an
   * off-topic article in the pool; this floor drops those weak matches to keep
   * an empty result meaningful ("nothing relevant") on the keyword-only path.
   */
  keywordRankFloor?: number
}

/** Default number of articles stuffed into the synthesis context. */
export const KB_ASK_TOP_K = 5

/** Per-article content budget for the synthesis context (trimmed in SQL). */
export const KB_ASK_CONTEXT_CHARS = 4000

/** Select the article content pre-trimmed to the context budget, so whole
 *  long articles never cross the wire just to be sliced in JS. */
const trimmedContent = () =>
  sql<string>`left(${helpCenterArticles.content}, ${KB_ASK_CONTEXT_CHARS})`

/**
 * Retrieve the top-k most relevant knowledge-base articles for a query.
 *
 * Uses semantic similarity when the embedding service can embed the query;
 * falls back to keyword (tsvector) ranking when embeddings are unavailable.
 * Always returns an array; empty means nothing relevant was found.
 */
export async function retrieveKbArticles(
  query: string,
  options: RetrieveKbArticlesOptions = {}
): Promise<RetrievedKbArticle[]> {
  const audience = options.audience ?? 'public'
  const topK = options.topK ?? KB_ASK_TOP_K
  const minScore = options.minScore ?? SEMANTIC_SIMILARITY_FLOOR
  const keywordRankFloor = options.keywordRankFloor ?? KEYWORD_RANK_FLOOR

  const embedding = await generateKbQueryEmbedding(query, {
    pipelineStep: 'kb_retrieval_query_embedding',
  })

  const rows = embedding
    ? await hybridQuery(query, embedding, audience, topK, minScore, keywordRankFloor)
    : await keywordQuery(query, audience, topK, keywordRankFloor)

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    content: r.content ?? '',
    categoryId: r.categoryId,
    categorySlug: r.categorySlug,
    categoryName: r.categoryName,
    score: Number(r.score),
    isPublic: r.isPublic,
  }))
}

interface RetrievalRow {
  id: string
  slug: string
  title: string
  content: string
  categoryId: string
  categorySlug: string
  categoryName: string
  score: number
  isPublic: boolean
}

/** The same three predicates the 'public' branch of {@link helpCenterVisibilityConditions}
 *  requires, computed per row so a 'team' query (which admits both) can tell them apart. */
const isPublicRow = () =>
  sql<boolean>`(${helpCenterCategories.isPublic} AND ${helpCenterArticles.publishedAt} IS NOT NULL AND ${helpCenterArticles.publishedAt} <= now())`

/**
 * Hybrid retrieval: an article matches on a keyword hit OR a semantic hit above
 * the floor, and is ranked by the same weighted blend the help-center search box
 * uses (keyword ts_rank + cosine similarity). Pure-semantic retrieval missed
 * natural-language questions whose phrasing scored just under the cosine floor
 * even when the exact article existed; the keyword arm and blended ranking
 * recover those without lowering the grounding bar. The floor still gates the
 * semantic arm, so `minScore` (0.3 for "related" near-misses) widens recall the
 * same way it did before.
 */
async function hybridQuery(
  query: string,
  embedding: number[],
  audience: HelpCenterAudience,
  topK: number,
  minScore: number,
  rankFloor: number
): Promise<RetrievalRow[]> {
  const vectorStr = `[${embedding.join(',')}]`
  const tsQuery = orTermsTsQuery(query)
  const semantic = sql<number>`COALESCE(1 - (${helpCenterArticles.embedding} <=> ${vectorStr}::vector), 0)`
  const keyword = sql<number>`COALESCE(ts_rank(${helpCenterArticles.searchVector}, ${tsQuery}), 0)`
  const combined = sql<number>`(${KEYWORD_WEIGHT} * ${keyword} + ${SEMANTIC_WEIGHT} * ${semantic})`

  return db
    .select({
      id: helpCenterArticles.id,
      slug: helpCenterArticles.slug,
      title: helpCenterArticles.title,
      content: trimmedContent(),
      categoryId: helpCenterArticles.categoryId,
      categorySlug: helpCenterCategories.slug,
      categoryName: helpCenterCategories.name,
      score: combined.as('score'),
      isPublic: isPublicRow().as('is_public_row'),
    })
    .from(helpCenterArticles)
    .innerJoin(
      helpCenterCategories,
      sql`${helpCenterArticles.categoryId} = ${helpCenterCategories.id}`
    )
    .where(
      and(
        ...helpCenterVisibilityConditions(audience),
        // A keyword match must clear the same ts_rank floor as the keyword-only
        // path (OR-of-terms otherwise admits a lone incidental term); a semantic
        // match above the cosine floor always qualifies.
        sql`(
          (
            ${helpCenterArticles.searchVector} @@ ${tsQuery}
            AND ts_rank(${helpCenterArticles.searchVector}, ${tsQuery}) > ${rankFloor}
          )
          OR (
            ${helpCenterArticles.embedding} IS NOT NULL
            AND 1 - (${helpCenterArticles.embedding} <=> ${vectorStr}::vector) > ${minScore}
          )
        )`
      )
    )
    .orderBy(sql`score DESC`)
    .limit(topK)
}

async function keywordQuery(
  query: string,
  audience: HelpCenterAudience,
  topK: number,
  rankFloor: number
): Promise<RetrievalRow[]> {
  const tsQuery = orTermsTsQuery(query)
  const rank = sql<number>`ts_rank(${helpCenterArticles.searchVector}, ${tsQuery})`

  return db
    .select({
      id: helpCenterArticles.id,
      slug: helpCenterArticles.slug,
      title: helpCenterArticles.title,
      content: trimmedContent(),
      categoryId: helpCenterArticles.categoryId,
      categorySlug: helpCenterCategories.slug,
      categoryName: helpCenterCategories.name,
      score: rank.as('score'),
      isPublic: isPublicRow().as('is_public_row'),
    })
    .from(helpCenterArticles)
    .innerJoin(
      helpCenterCategories,
      sql`${helpCenterArticles.categoryId} = ${helpCenterCategories.id}`
    )
    .where(
      and(
        ...helpCenterVisibilityConditions(audience),
        sql`${helpCenterArticles.searchVector} @@ ${tsQuery}`,
        sql`ts_rank(${helpCenterArticles.searchVector}, ${tsQuery}) > ${rankFloor}`
      )
    )
    .orderBy(sql`score DESC`)
    .limit(topK)
}
