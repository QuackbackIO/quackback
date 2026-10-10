/**
 * Help Center Related Articles Service
 *
 * Recommends articles related to a given article for the public article
 * page's Related Articles block. Ranking reuses the hybrid-search building
 * blocks (visibility predicate, OR-of-terms tsquery, rank floors) so
 * recommendations agree with search on what "relevant" means.
 */

import {
  db,
  helpCenterArticles,
  helpCenterCategories,
  and,
  eq,
  ne,
  isNull,
  notInArray,
  sql,
} from '@/lib/server/db'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import {
  helpCenterVisibilityConditions,
  orTermsTsQuery,
  KEYWORD_RANK_FLOOR,
} from './help-center-search.service'

/**
 * Cosine-similarity floor for related-article candidates. Mirrors the
 * assistant retrieval module's related floor (0.3, below the search floor):
 * recommendations tolerate weaker matches than an explicit search because the
 * reader already signaled interest by opening the article. Declared locally
 * rather than imported from domains/assistant -- the assistant retrieval
 * module imports the search service, and this module does too, so importing
 * retrieval here would close a cycle.
 */
export const RELATED_ARTICLE_SIMILARITY_FLOOR = 0.3

/** Default size of the Related Articles block on the public article page. */
export const RELATED_ARTICLES_LIMIT = 4

/** pgvector may come back as number[] or a '[1,2,...]' string depending on the driver. */
function embeddingToVectorLiteral(embedding: unknown): string | null {
  if (embedding == null) return null
  if (Array.isArray(embedding)) return `[${embedding.join(',')}]`
  if (typeof embedding === 'string' && embedding.length > 0) {
    return embedding.startsWith('[') ? embedding : `[${embedding}]`
  }
  return null
}

export interface RelatedArticle {
  id: string
  urlId: number
  slug: string
  title: string
  description: string | null
  categorySlug: string
}

const relatedArticleColumns = {
  id: helpCenterArticles.id,
  urlId: helpCenterArticles.urlId,
  slug: helpCenterArticles.slug,
  title: helpCenterArticles.title,
  description: helpCenterArticles.description,
  categorySlug: helpCenterCategories.slug,
}

/**
 * Recommend articles related to a given article for the public article page.
 *
 * Ranking tiers:
 * 1. Semantic: nearest neighbors of the article's own stored embedding
 *    (cosine similarity above {@link RELATED_ARTICLE_SIMILARITY_FLOOR}). No
 *    embedding is generated here -- the article's stored vector is the query,
 *    so the article page never pays for an API call.
 * 2. Keyword: OR-of-terms tsquery built from the article title, with the same
 *    ts_rank floor search uses.
 *
 * The article itself is always excluded, candidates come from the same public
 * visibility slice as search, and a scarce ranked pool is padded with the
 * most recently published articles from the same category so the block stays
 * useful for young or unembedded content.
 */
export async function getRelatedArticles(
  articleId: string,
  limit = RELATED_ARTICLES_LIMIT,
  viewer: Actor = ANONYMOUS_ACTOR
): Promise<RelatedArticle[]> {
  const [source] = await db
    .select({
      id: helpCenterArticles.id,
      title: helpCenterArticles.title,
      categoryId: helpCenterArticles.categoryId,
      embedding: helpCenterArticles.embedding,
    })
    .from(helpCenterArticles)
    .where(and(eq(helpCenterArticles.id, articleId as never), isNull(helpCenterArticles.deletedAt)))
    .limit(1)

  if (!source) return []

  const visibility = helpCenterVisibilityConditions('public', viewer)
  const notSelf = ne(helpCenterArticles.id, source.id as never)

  let scoreExpr
  let matchCondition
  const vectorStr = embeddingToVectorLiteral(source.embedding)
  if (vectorStr) {
    scoreExpr = sql<number>`1 - (${helpCenterArticles.embedding} <=> ${vectorStr}::vector)`.as(
      'related_score'
    )
    matchCondition = sql`(
      ${helpCenterArticles.embedding} IS NOT NULL
      AND 1 - (${helpCenterArticles.embedding} <=> ${vectorStr}::vector) > ${RELATED_ARTICLE_SIMILARITY_FLOOR}
    )`
  } else {
    const tsQuery = orTermsTsQuery(source.title)
    scoreExpr = sql<number>`ts_rank(${helpCenterArticles.searchVector}, ${tsQuery})`.as(
      'related_score'
    )
    matchCondition = sql`(
      ${helpCenterArticles.searchVector} @@ ${tsQuery}
      AND ts_rank(${helpCenterArticles.searchVector}, ${tsQuery}) > ${KEYWORD_RANK_FLOOR}
    )`
  }

  const ranked = await db
    .select({ ...relatedArticleColumns, score: scoreExpr })
    .from(helpCenterArticles)
    .innerJoin(
      helpCenterCategories,
      sql`${helpCenterArticles.categoryId} = ${helpCenterCategories.id}`
    )
    .where(and(...visibility, notSelf, matchCondition))
    .orderBy(sql`related_score DESC`)
    .limit(limit)

  const related: RelatedArticle[] = ranked.map((r) => ({
    id: r.id,
    urlId: r.urlId,
    slug: r.slug,
    title: r.title,
    description: r.description,
    categorySlug: r.categorySlug,
  }))

  const remaining = limit - related.length
  if (remaining > 0) {
    const seen = related.map((r) => r.id)
    const padding = await db
      .select(relatedArticleColumns)
      .from(helpCenterArticles)
      .innerJoin(
        helpCenterCategories,
        sql`${helpCenterArticles.categoryId} = ${helpCenterCategories.id}`
      )
      .where(
        and(
          ...visibility,
          notSelf,
          eq(helpCenterArticles.categoryId, source.categoryId),
          ...(seen.length > 0 ? [notInArray(helpCenterArticles.id, seen as never)] : [])
        )
      )
      .orderBy(sql`${helpCenterArticles.publishedAt} DESC`)
      .limit(remaining)

    for (const row of padding) {
      if (related.some((r) => r.id === row.id)) continue
      related.push({
        id: row.id,
        urlId: row.urlId,
        slug: row.slug,
        title: row.title,
        description: row.description,
        categorySlug: row.categorySlug,
      })
    }
  }

  return related
}
