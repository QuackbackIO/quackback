import {
  db,
  helpCenterCategories,
  helpCenterArticles,
  eq,
  and,
  isNull,
  asc,
  sql,
} from '@/lib/server/db'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import { segmentGateAllows } from '@/lib/server/policy/segment-gate'
import { helpCenterVisibilityConditions } from './help-center-search.service'
import { computeRecursiveCounts } from './category-tree'
import type { HelpCenterCategoryWithCount } from './help-center.types'

/**
 * The categories a help center visitor can open, each counted by the articles
 * that visitor can open: published, not gated away from them, in a category
 * they can open. A subcategory the visitor cannot open adds nothing to its
 * parent's count, nor does anything beneath it, since the visitor cannot
 * reach it from the parent's page either.
 */
export async function listPublicCategories(
  viewer: Actor = ANONYMOUS_ACTOR
): Promise<HelpCenterCategoryWithCount[]> {
  const [categories, counts] = await Promise.all([
    db.query.helpCenterCategories.findMany({
      where: isNull(helpCenterCategories.deletedAt),
      orderBy: [asc(helpCenterCategories.position), asc(helpCenterCategories.name)],
    }),
    db
      .select({
        categoryId: helpCenterArticles.categoryId,
        visibleCount: sql<number>`count(*)::int`.as('visible_count'),
      })
      .from(helpCenterArticles)
      .innerJoin(helpCenterCategories, eq(helpCenterCategories.id, helpCenterArticles.categoryId))
      .where(and(...helpCenterVisibilityConditions('public', viewer)))
      .groupBy(helpCenterArticles.categoryId),
  ])

  // Same per-category semantics as the article-side predicate
  // (helpCenterVisibilityConditions): public, and the segment gate admits the
  // viewer ([] = everyone).
  const open = categories.filter((cat) => cat.isPublic && segmentGateAllows(viewer, cat.segmentIds))
  const direct = new Map(counts.map((c) => [c.categoryId as string, c.visibleCount]))
  const recursive = computeRecursiveCounts(
    open.map((c) => ({ id: c.id, parentId: c.parentId ?? null })),
    (id) => direct.get(id) ?? 0
  )

  return open
    .map((cat) => {
      const total = recursive.get(cat.id) ?? 0
      return {
        ...cat,
        articleCount: total,
        publishedArticleCount: direct.get(cat.id) ?? 0,
        recursiveArticleCount: total,
        recursivePublishedArticleCount: total,
      }
    })
    .filter((cat) => cat.articleCount > 0)
}
