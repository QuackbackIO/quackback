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
import { generateKbEmbedding } from '@/lib/server/domains/help-center/help-center-embedding.service'
import {
  helpCenterVisibilityConditions,
  SEMANTIC_SIMILARITY_FLOOR,
  type HelpCenterAudience,
} from '@/lib/server/domains/help-center/help-center-search.service'

export interface RetrievedKbArticle {
  id: string
  slug: string
  title: string
  content: string
  categoryId: string
  categorySlug: string
  categoryName: string
  score: number
}

export interface RetrieveKbArticlesOptions {
  audience?: HelpCenterAudience
  topK?: number
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

  const embedding = await generateKbEmbedding(query, {
    pipelineStep: 'kb_retrieval_query_embedding',
  })

  const rows = embedding
    ? await semanticQuery(embedding, audience, topK)
    : await keywordQuery(query, audience, topK)

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    content: r.content ?? '',
    categoryId: r.categoryId,
    categorySlug: r.categorySlug,
    categoryName: r.categoryName,
    score: Number(r.score),
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
}

async function semanticQuery(
  embedding: number[],
  audience: HelpCenterAudience,
  topK: number
): Promise<RetrievalRow[]> {
  const vectorStr = `[${embedding.join(',')}]`
  const similarity = sql<number>`1 - (${helpCenterArticles.embedding} <=> ${vectorStr}::vector)`

  return db
    .select({
      id: helpCenterArticles.id,
      slug: helpCenterArticles.slug,
      title: helpCenterArticles.title,
      content: trimmedContent(),
      categoryId: helpCenterArticles.categoryId,
      categorySlug: helpCenterCategories.slug,
      categoryName: helpCenterCategories.name,
      score: similarity.as('score'),
    })
    .from(helpCenterArticles)
    .innerJoin(
      helpCenterCategories,
      sql`${helpCenterArticles.categoryId} = ${helpCenterCategories.id}`
    )
    .where(
      and(
        ...helpCenterVisibilityConditions(audience),
        sql`${helpCenterArticles.embedding} IS NOT NULL`,
        sql`1 - (${helpCenterArticles.embedding} <=> ${vectorStr}::vector) > ${SEMANTIC_SIMILARITY_FLOOR}`
      )
    )
    .orderBy(sql`score DESC`)
    .limit(topK)
}

async function keywordQuery(
  query: string,
  audience: HelpCenterAudience,
  topK: number
): Promise<RetrievalRow[]> {
  const tsQuery = sql`websearch_to_tsquery('english', ${query})`

  return db
    .select({
      id: helpCenterArticles.id,
      slug: helpCenterArticles.slug,
      title: helpCenterArticles.title,
      content: trimmedContent(),
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
        ...helpCenterVisibilityConditions(audience),
        sql`${helpCenterArticles.searchVector} @@ ${tsQuery}`
      )
    )
    .orderBy(sql`score DESC`)
    .limit(topK)
}
