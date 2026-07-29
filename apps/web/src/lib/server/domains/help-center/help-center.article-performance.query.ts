import { db, helpCenterCategories, helpCenterArticles, eq, isNull, desc } from '@/lib/server/db'
import type { KbArticleId } from '@quackback/ids'

/** Default row cap for {@link listArticlePerformance} -- the admin table reads
 *  as a ranked top list, not a paginated archive. */
export const ARTICLE_PERFORMANCE_LIMIT = 100

/** One row of the admin article-performance table. */
export interface ArticlePerformanceRow {
  id: KbArticleId
  slug: string
  title: string
  status: 'draft' | 'published'
  categoryName: string
  viewCount: number
  helpfulCount: number
  notHelpfulCount: number
}

/**
 * Non-deleted articles ranked by view count, each carrying the helpful /
 * not-helpful tallies already maintained on the row (see
 * help-center.article-feedback.service.ts). Ties broken by helpful count so
 * two equally-viewed articles surface the better-received one first.
 */
export async function listArticlePerformance(
  limit: number = ARTICLE_PERFORMANCE_LIMIT
): Promise<ArticlePerformanceRow[]> {
  const rows = await db
    .select({
      id: helpCenterArticles.id,
      slug: helpCenterArticles.slug,
      title: helpCenterArticles.title,
      publishedAt: helpCenterArticles.publishedAt,
      categoryName: helpCenterCategories.name,
      viewCount: helpCenterArticles.viewCount,
      helpfulCount: helpCenterArticles.helpfulCount,
      notHelpfulCount: helpCenterArticles.notHelpfulCount,
    })
    .from(helpCenterArticles)
    .innerJoin(helpCenterCategories, eq(helpCenterCategories.id, helpCenterArticles.categoryId))
    .where(isNull(helpCenterArticles.deletedAt))
    .orderBy(desc(helpCenterArticles.viewCount), desc(helpCenterArticles.helpfulCount))
    .limit(limit)

  return rows.map((row) => ({
    id: row.id as KbArticleId,
    slug: row.slug,
    title: row.title,
    status: row.publishedAt ? ('published' as const) : ('draft' as const),
    categoryName: row.categoryName,
    viewCount: row.viewCount,
    helpfulCount: row.helpfulCount,
    notHelpfulCount: row.notHelpfulCount,
  }))
}
