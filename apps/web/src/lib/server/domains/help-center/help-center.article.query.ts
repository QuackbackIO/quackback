import {
  db,
  helpCenterCategories,
  helpCenterArticles,
  principal,
  eq,
  and,
  isNull,
  isNotNull,
  lte,
  lt,
  gt,
  or,
  desc,
  asc,
  sql,
  inArray,
} from '@/lib/server/db'
import type { HelpCenterArticleId, HelpCenterCategoryId, PrincipalId } from '@quackback/ids'
import type {
  HelpCenterArticleWithCategory,
  ListArticlesParams,
  ArticleListResult,
} from './help-center.types'

// ============================================================================
// Article Queries
// ============================================================================

export async function listArticles(params: ListArticlesParams): Promise<ArticleListResult> {
  const {
    categoryId,
    status = 'all',
    search,
    cursor,
    limit = 20,
    showDeleted = false,
    sort = 'newest',
  } = params
  const now = new Date()

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const conditions = showDeleted
    ? [
        isNotNull(helpCenterArticles.deletedAt),
        sql`${helpCenterArticles.deletedAt} >= ${thirtyDaysAgo}`,
      ]
    : [isNull(helpCenterArticles.deletedAt)]

  if (categoryId) {
    conditions.push(eq(helpCenterArticles.categoryId, categoryId as HelpCenterCategoryId))
  }

  if (!showDeleted) {
    if (status === 'published') {
      conditions.push(isNotNull(helpCenterArticles.publishedAt))
      conditions.push(lte(helpCenterArticles.publishedAt, now))
    } else if (status === 'draft') {
      conditions.push(isNull(helpCenterArticles.publishedAt))
    }
  }

  if (search?.trim()) {
    conditions.push(
      sql`${helpCenterArticles.searchVector} @@ websearch_to_tsquery('english', ${search.trim()})`
    )
  }

  if (cursor) {
    const cursorEntry = await db.query.helpCenterArticles.findFirst({
      where: eq(helpCenterArticles.id, cursor as HelpCenterArticleId),
      columns: { createdAt: true },
    })
    if (cursorEntry?.createdAt) {
      if (sort === 'oldest') {
        conditions.push(
          or(
            gt(helpCenterArticles.createdAt, cursorEntry.createdAt),
            and(
              eq(helpCenterArticles.createdAt, cursorEntry.createdAt),
              gt(helpCenterArticles.id, cursor as HelpCenterArticleId)
            )
          )!
        )
      } else {
        conditions.push(
          or(
            lt(helpCenterArticles.createdAt, cursorEntry.createdAt),
            and(
              eq(helpCenterArticles.createdAt, cursorEntry.createdAt),
              lt(helpCenterArticles.id, cursor as HelpCenterArticleId)
            )
          )!
        )
      }
    }
  }

  const orderByClause =
    sort === 'oldest'
      ? [asc(helpCenterArticles.createdAt), asc(helpCenterArticles.id)]
      : [desc(helpCenterArticles.createdAt), desc(helpCenterArticles.id)]

  // Exclude heavy columns (contentJson, embedding, searchVector) from the list
  // query — the list UI only needs metadata + a short preview of `content`.
  const articles = await db.query.helpCenterArticles.findMany({
    where: and(...conditions),
    orderBy: orderByClause,
    limit: limit + 1,
    columns: {
      id: true,
      categoryId: true,
      slug: true,
      title: true,
      description: true,
      position: true,
      content: true,
      principalId: true,
      publishedAt: true,
      viewCount: true,
      helpfulCount: true,
      notHelpfulCount: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
    },
  })

  const hasMore = articles.length > limit
  const items = hasMore ? articles.slice(0, limit) : articles

  // Batch resolve categories and authors
  const categoryIds = [...new Set(items.map((a) => a.categoryId))]
  const principalIds = [
    ...new Set(items.map((a) => a.principalId).filter(Boolean)),
  ] as PrincipalId[]

  const [categories, principals] = await Promise.all([
    categoryIds.length > 0
      ? db.query.helpCenterCategories.findMany({
          where: inArray(helpCenterCategories.id, categoryIds),
          columns: { id: true, slug: true, name: true },
        })
      : [],
    principalIds.length > 0
      ? db.query.principal.findMany({
          where: inArray(principal.id, principalIds),
          columns: { id: true, displayName: true, avatarUrl: true },
        })
      : [],
  ])

  const categoryMap = new Map(categories.map((c) => [c.id, c]))
  const authorMap = new Map(principals.map((p) => [p.id, p]))

  const resolved: HelpCenterArticleWithCategory[] = items.map((article) => {
    const cat = categoryMap.get(article.categoryId)
    const author = article.principalId ? authorMap.get(article.principalId) : null
    return {
      ...article,
      // contentJson is omitted from the list query for performance — consumers
      // that need the full JSON (e.g. article detail page) call getArticleById.
      contentJson: null,
      category: cat
        ? { id: cat.id as HelpCenterCategoryId, slug: cat.slug, name: cat.name }
        : { id: article.categoryId as HelpCenterCategoryId, slug: '', name: 'Unknown' },
      author: author?.displayName
        ? { id: author.id as PrincipalId, name: author.displayName, avatarUrl: author.avatarUrl }
        : null,
    }
  })

  return {
    items: resolved,
    nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id : null,
    hasMore,
  }
}

export async function listPublicArticles(params: {
  categoryId?: string
  search?: string
  cursor?: string
  limit?: number
}): Promise<ArticleListResult> {
  return listArticles({ ...params, status: 'published' })
}

export async function listPublicArticlesForCategory(categoryId: string) {
  return db
    .select({
      id: helpCenterArticles.id,
      slug: helpCenterArticles.slug,
      title: helpCenterArticles.title,
      description: helpCenterArticles.description,
      position: helpCenterArticles.position,
      publishedAt: helpCenterArticles.publishedAt,
      readingTimeMinutes: sql<number>`GREATEST(1, ROUND(length(${helpCenterArticles.content}) / 1200.0))`,
      authorName: principal.displayName,
      authorAvatarUrl: principal.avatarUrl,
    })
    .from(helpCenterArticles)
    .leftJoin(principal, eq(principal.id, helpCenterArticles.principalId))
    .where(
      and(
        eq(helpCenterArticles.categoryId, categoryId as HelpCenterCategoryId),
        isNotNull(helpCenterArticles.publishedAt),
        isNull(helpCenterArticles.deletedAt)
      )
    )
    .orderBy(asc(helpCenterArticles.position), asc(helpCenterArticles.publishedAt))
}

export async function listPublicCategoryEditors(): Promise<
  Record<string, Array<{ name: string; avatarUrl: string | null }>>
> {
  const rows = await db
    .select({
      categoryId: helpCenterArticles.categoryId,
      principalId: helpCenterArticles.principalId,
      displayName: principal.displayName,
      avatarUrl: principal.avatarUrl,
    })
    .from(helpCenterArticles)
    .innerJoin(principal, eq(principal.id, helpCenterArticles.principalId))
    .where(and(
      isNotNull(helpCenterArticles.publishedAt),
      isNull(helpCenterArticles.deletedAt),
      inArray(principal.role, ['admin', 'member'])
    ))
    .orderBy(asc(helpCenterArticles.categoryId), desc(helpCenterArticles.publishedAt))

  const result: Record<string, Array<{ name: string; avatarUrl: string | null }>> = {}
  const seen = new Set<string>()
  for (const row of rows) {
    const catId = row.categoryId as string
    const key = `${catId}:${row.principalId}`
    if (seen.has(key)) continue
    seen.add(key)
    if (!result[catId]) result[catId] = []
    if (result[catId].length < 3 && row.displayName) {
      result[catId].push({ name: row.displayName, avatarUrl: row.avatarUrl })
    }
  }
  return result
}
