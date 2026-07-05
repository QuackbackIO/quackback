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
  helpCenterArticleTranslations,
  helpCenterCategoryTranslations,
  and,
  eq,
  isNull,
  isNotNull,
  lte,
  sql,
  regconfigForLocale,
} from '@/lib/server/db'
import { DEFAULT_LOCALE } from '@/lib/shared/i18n'
import { generateKbQueryEmbedding } from './help-center-embedding.service'

export const KEYWORD_WEIGHT = 0.4
export const SEMANTIC_WEIGHT = 0.6

/**
 * Cosine-similarity floor for semantic matches: rows below it are simply absent
 * from results. Shared with the assistant's retrieval module so search and AI
 * answers agree on what "relevant" means. Tuned for text-embedding-3-small,
 * whose clearly-relevant matches sit around 0.4+ and unrelated ones below 0.3;
 * the earlier 0.5 cut valid matches (e.g. paraphrased questions) while adding no
 * precision. Stays above RELATED_SIMILARITY_FLOOR so near-misses can still be
 * suggested on a no-answer.
 */
export const SEMANTIC_SIMILARITY_FLOOR = 0.35

/**
 * ts_rank floor for keyword matches. OR-of-terms matching (see {@link orTermsTsQuery})
 * trades AND's precision for recall, so a lone incidental term ("password" in an
 * unrelated query) would otherwise linger; this floor drops those weak matches so
 * an empty keyword result still means "nothing relevant". Tuned empirically.
 */
export const KEYWORD_RANK_FLOOR = 0.3

/**
 * Corpus-specific stopwords: the product's own name appears in nearly every
 * article, so as a query term it is pure noise that inflates the keyword score
 * of unrelated articles. Dropped before building the tsquery.
 */
const CORPUS_STOPWORDS = new Set(['quackback'])

/**
 * Build an OR-of-terms tsquery. websearch_to_tsquery ANDs every term by default,
 * so one extra word a natural-language question carries that the article lacks
 * ("How do I *actually*…") drops the whole match. Joining terms with websearch's
 * "or" operator matches on ANY term and lets ts_rank reward articles that hit
 * more of them. English stopwords, stemming, and punctuation are handled by
 * websearch; an empty query yields a match-nothing tsquery.
 */
export function orTermsTsQuery(query: string) {
  const orQuery = query
    .trim()
    .split(/\s+/)
    .filter((w) => w && !CORPUS_STOPWORDS.has(w.toLowerCase().replace(/[^a-z0-9]/g, '')))
    .join(' or ')
  return sql`websearch_to_tsquery('english', ${orQuery})`
}

/**
 * Same OR-of-terms construction as {@link orTermsTsQuery}, but keyed off a
 * locale's regconfig (domains/languages §2) instead of hardcoded 'english' --
 * used against kb_article_translations.search_vector, which is itself
 * generated with the same per-locale config (see LOCALE_TO_REGCONFIG /
 * localeRegconfigCaseSql in packages/db/src/schema/kb.ts).
 */
export function orTermsTsQueryForLocale(query: string, locale: string) {
  const orQuery = query
    .trim()
    .split(/\s+/)
    .filter((w) => w && !CORPUS_STOPWORDS.has(w.toLowerCase().replace(/[^a-z0-9]/g, '')))
    .join(' or ')
  const regconfig = regconfigForLocale(locale)
  return sql`websearch_to_tsquery(${regconfig}::regconfig, ${orQuery})`
}

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
  const queryEmbedding = await generateKbQueryEmbedding(query, {
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
  const tsQuery = orTermsTsQuery(query)

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
        // A keyword hit must clear the ts_rank floor (OR-of-terms otherwise
        // admits a lone incidental term); a semantic hit above the cosine
        // floor always qualifies.
        sql`(
          (
            ${helpCenterArticles.searchVector} @@ ${tsQuery}
            AND ts_rank(${helpCenterArticles.searchVector}, ${tsQuery}) > ${KEYWORD_RANK_FLOOR}
          )
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

  const tsQuery = orTermsTsQuery(query)
  const queryEmbedding = await generateKbQueryEmbedding(query, {
    pipelineStep: 'kb_search_query_embedding',
  })

  const keywordMatch = sql`(
    ${helpCenterArticles.searchVector} @@ ${tsQuery}
    AND ts_rank(${helpCenterArticles.searchVector}, ${tsQuery}) > ${KEYWORD_RANK_FLOOR}
  )`

  let scoreExpr
  let matchCondition
  if (queryEmbedding) {
    const vectorStr = `[${queryEmbedding.join(',')}]`
    scoreExpr = sql<number>`(
      ${KEYWORD_WEIGHT} * COALESCE(ts_rank(${helpCenterArticles.searchVector}, ${tsQuery}), 0) +
      ${SEMANTIC_WEIGHT} * COALESCE(1 - (${helpCenterArticles.embedding} <=> ${vectorStr}::vector), 0)
    )`.as('rank_score')
    matchCondition = sql`(
      ${keywordMatch}
      OR (
        ${helpCenterArticles.embedding} IS NOT NULL
        AND 1 - (${helpCenterArticles.embedding} <=> ${vectorStr}::vector) > ${SEMANTIC_SIMILARITY_FLOOR}
      )
    )`
  } else {
    scoreExpr = sql<number>`ts_rank(${helpCenterArticles.searchVector}, ${tsQuery})`.as(
      'rank_score'
    )
    matchCondition = keywordMatch
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
  const tsQuery = orTermsTsQuery(query)

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
        sql`${helpCenterArticles.searchVector} @@ ${tsQuery}`,
        sql`ts_rank(${helpCenterArticles.searchVector}, ${tsQuery}) > ${KEYWORD_RANK_FLOOR}`
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

// ============================================================================
// Per-locale search (domains/languages §2)
// ============================================================================

/**
 * Keyword-only search over kb_article_translations for an ADDITIONAL locale.
 * Embeddings stay default-locale only (a cost decision, not a correctness
 * one), so there is no semantic component here -- this is the per-locale
 * analogue of {@link keywordOnlyQuery}, not of the full hybrid query.
 * Only published translations of published, public, non-deleted articles
 * are eligible (the shared visibility predicate still gates the base row).
 */
async function keywordOnlyQueryForLocale(
  query: string,
  locale: string,
  limit: number
): Promise<HybridSearchResult[]> {
  const tsQuery = orTermsTsQueryForLocale(query, locale)

  const results = await db
    .select({
      id: helpCenterArticles.id,
      slug: helpCenterArticles.slug,
      title: helpCenterArticleTranslations.title,
      description: helpCenterArticleTranslations.description,
      content: helpCenterArticleTranslations.content,
      categoryId: helpCenterArticles.categoryId,
      categorySlug: helpCenterCategories.slug,
      categoryName: sql<string>`COALESCE(NULLIF(${helpCenterCategoryTranslations.name}, ''), ${helpCenterCategories.name})`,
      score: sql<number>`ts_rank(${helpCenterArticleTranslations.searchVector}, ${tsQuery})`.as(
        'score'
      ),
    })
    .from(helpCenterArticleTranslations)
    .innerJoin(
      helpCenterArticles,
      eq(helpCenterArticleTranslations.articleId, helpCenterArticles.id)
    )
    .innerJoin(
      helpCenterCategories,
      sql`${helpCenterArticles.categoryId} = ${helpCenterCategories.id}`
    )
    .leftJoin(
      helpCenterCategoryTranslations,
      and(
        eq(helpCenterCategoryTranslations.categoryId, helpCenterCategories.id),
        eq(helpCenterCategoryTranslations.locale, locale)
      )
    )
    .where(
      and(
        eq(helpCenterArticleTranslations.locale, locale),
        eq(helpCenterArticleTranslations.status, 'published'),
        ...helpCenterVisibilityConditions('public'),
        sql`${helpCenterArticleTranslations.searchVector} @@ ${tsQuery}`,
        sql`ts_rank(${helpCenterArticleTranslations.searchVector}, ${tsQuery}) > ${KEYWORD_RANK_FLOOR}`
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

/**
 * Locale-dispatching entry point for the public /hc search box. The default
 * locale keeps the full hybrid (keyword + semantic) search unchanged;
 * additional locales get keyword-only search against their translations.
 */
export async function hybridSearchForLocale(
  query: string,
  locale: string,
  limit = 10
): Promise<HybridSearchResult[]> {
  if (locale === DEFAULT_LOCALE) return hybridSearch(query, limit)
  return keywordOnlyQueryForLocale(query, locale, limit)
}

/**
 * A caller-supplied locale (portal route param, widget's own UI locale) is
 * only honored when that locale is actually enabled for this help center --
 * otherwise every translation-table query would just come back empty and
 * search would silently look broken. Falls back to the default locale.
 */
export function resolveSearchLocale(
  requestedLocale: string | undefined,
  enabledAdditionalLocales: string[],
  defaultLocale: string
): string {
  if (requestedLocale && enabledAdditionalLocales.includes(requestedLocale)) {
    return requestedLocale
  }
  return defaultLocale
}
