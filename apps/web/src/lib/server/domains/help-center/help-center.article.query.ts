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
import type { KbArticleId, KbCategoryId, PrincipalId } from '@quackback/ids'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import type {
  HelpCenterArticleWithCategory,
  ListArticlesParams,
  ArticleListResult,
} from './help-center.types'
import {
  searchArticleIdsRanked,
  helpCenterVisibilityConditions,
  publicCategoryExistsCondition,
  RANKED_SEARCH_POOL,
} from './help-center-search.service'

/**
 * Who a list query serves. `team` (default) is the admin/MCP/REST surface:
 * drafts and private/gated categories included. `public` narrows to the
 * public help-center slice, with `viewer` driving the category segment gate
 * (defaults to ANONYMOUS_ACTOR — fail closed).
 */
export interface ArticleListScope {
  audience?: 'team' | 'public'
  viewer?: Actor
}

// ============================================================================
// Article Queries
// ============================================================================

// The list query intentionally excludes heavy columns (contentJson,
// embedding, searchVector) — the list UI only needs metadata + a short
// preview of `content`.
const LIST_COLUMNS = {
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
} as const

export async function listArticles(
  params: ListArticlesParams,
  scope: ArticleListScope = {}
): Promise<ArticleListResult> {
  const {
    categoryId,
    status = 'all',
    search,
    cursor,
    limit = 20,
    showDeleted = false,
    sort = 'newest',
  } = params
  const audience = scope.audience ?? 'team'
  const viewer = scope.viewer ?? ANONYMOUS_ACTOR
  const now = new Date()

  // Text search rides the same hybrid ranking as the public help center
  // (keyword + semantic), with the caller's scope (team keeps drafts and
  // private categories; public narrows to the viewer's slice).
  // The trash view keeps the plain keyword filter below: soft-deleted rows
  // are excluded from ranking by design.
  const searchTerm = search?.trim()
  if (searchTerm && !showDeleted) {
    return listArticlesRanked(searchTerm, { categoryId, status, cursor, limit, audience, viewer })
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const conditions = showDeleted
    ? [
        isNotNull(helpCenterArticles.deletedAt),
        sql`${helpCenterArticles.deletedAt} >= ${thirtyDaysAgo}`,
      ]
    : [isNull(helpCenterArticles.deletedAt)]

  if (categoryId) {
    conditions.push(eq(helpCenterArticles.categoryId, categoryId as KbCategoryId))
  }

  // Public scope: the parent category must be live, public, and admit the
  // viewer's segments (EXISTS form of the shared visibility owner — the
  // relational findMany below has no category join to hang it on).
  if (audience === 'public') {
    conditions.push(publicCategoryExistsCondition(viewer))
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
      where: eq(helpCenterArticles.id, cursor as KbArticleId),
      columns: { createdAt: true },
    })
    if (cursorEntry?.createdAt) {
      if (sort === 'oldest') {
        conditions.push(
          or(
            gt(helpCenterArticles.createdAt, cursorEntry.createdAt),
            and(
              eq(helpCenterArticles.createdAt, cursorEntry.createdAt),
              gt(helpCenterArticles.id, cursor as KbArticleId)
            )
          )!
        )
      } else {
        conditions.push(
          or(
            lt(helpCenterArticles.createdAt, cursorEntry.createdAt),
            and(
              eq(helpCenterArticles.createdAt, cursorEntry.createdAt),
              lt(helpCenterArticles.id, cursor as KbArticleId)
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

  const articles = await db.query.helpCenterArticles.findMany({
    where: and(...conditions),
    orderBy: orderByClause,
    limit: limit + 1,
    columns: LIST_COLUMNS,
  })

  const hasMore = articles.length > limit
  const items = hasMore ? articles.slice(0, limit) : articles
  const resolved = await resolveArticleRelations(items)

  return {
    items: resolved,
    nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id : null,
    hasMore,
  }
}

/**
 * Search branch of listArticles: rank ids with the shared hybrid scorer,
 * paginate by slicing the ranked pool after the cursor, then load rows and
 * restore rank order.
 */
async function listArticlesRanked(
  searchTerm: string,
  opts: {
    categoryId?: string
    status: 'draft' | 'published' | 'all'
    cursor?: string
    limit: number
    audience: 'team' | 'public'
    viewer: Actor
  }
): Promise<ArticleListResult> {
  const rankedIds = await searchArticleIdsRanked(searchTerm, {
    audience: opts.audience,
    viewer: opts.viewer,
    categoryId: opts.categoryId,
    status: opts.status,
    limit: RANKED_SEARCH_POOL,
  })

  let window = rankedIds
  if (opts.cursor) {
    const idx = window.indexOf(opts.cursor)
    window = idx >= 0 ? window.slice(idx + 1) : []
  }
  const pageIds = window.slice(0, opts.limit)
  const hasMore = window.length > opts.limit

  const rows =
    pageIds.length > 0
      ? await db.query.helpCenterArticles.findMany({
          where: inArray(helpCenterArticles.id, pageIds as KbArticleId[]),
          columns: LIST_COLUMNS,
        })
      : []

  const rowById = new Map(rows.map((r) => [r.id as string, r]))
  const ordered = pageIds.flatMap((id) => {
    const row = rowById.get(id)
    return row ? [row] : []
  })
  const resolved = await resolveArticleRelations(ordered)

  return {
    items: resolved,
    nextCursor: hasMore && pageIds.length > 0 ? pageIds[pageIds.length - 1] : null,
    hasMore,
  }
}

type ArticleListRow = Omit<HelpCenterArticleWithCategory, 'contentJson' | 'category' | 'author'>

/** Batch resolve categories and authors for a page of article rows. */
async function resolveArticleRelations(
  items: ArticleListRow[]
): Promise<HelpCenterArticleWithCategory[]> {
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

  return items.map((article) => {
    const cat = categoryMap.get(article.categoryId)
    const author = article.principalId ? authorMap.get(article.principalId) : null
    return {
      ...article,
      // contentJson is omitted from the list query for performance — consumers
      // that need the full JSON (e.g. article detail page) call getArticleById.
      contentJson: null,
      category: cat
        ? { id: cat.id as KbCategoryId, slug: cat.slug, name: cat.name }
        : { id: article.categoryId as KbCategoryId, slug: '', name: 'Unknown' },
      author: author?.displayName
        ? { id: author.id as PrincipalId, name: author.displayName, avatarUrl: author.avatarUrl }
        : null,
    }
  })
}

export async function listPublicArticles(
  params: {
    categoryId?: string
    search?: string
    cursor?: string
    limit?: number
  },
  viewer: Actor = ANONYMOUS_ACTOR
): Promise<ArticleListResult> {
  return listArticles({ ...params, status: 'published' }, { audience: 'public', viewer })
}

export async function listPublicArticlesForCategory(
  categoryId: string,
  viewer: Actor = ANONYMOUS_ACTOR
) {
  // Join category so the shared public predicate can enforce isPublic +
  // non-deleted on the category side too. Without the join, an admin
  // marking a category private only hid it from the public nav; direct
  // category-id article lookups still returned the children.
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
    .innerJoin(helpCenterCategories, eq(helpCenterCategories.id, helpCenterArticles.categoryId))
    .leftJoin(principal, eq(principal.id, helpCenterArticles.principalId))
    .where(
      and(
        eq(helpCenterArticles.categoryId, categoryId as KbCategoryId),
        ...helpCenterVisibilityConditions('public', viewer)
      )
    )
    .orderBy(asc(helpCenterArticles.position), asc(helpCenterArticles.publishedAt))
}

/** Per-category cap for the batched category-articles load. Category pages
 *  render a bounded list, so this keeps a pathological category from dragging
 *  the whole page down. */
export const CATEGORY_ARTICLES_CAP = 200

/** One article row as returned by {@link listPublicArticlesForCategory}. */
export type PublicCategoryArticle = Awaited<
  ReturnType<typeof listPublicArticlesForCategory>
>[number]

/**
 * Batched multi-category variant of {@link listPublicArticlesForCategory}:
 * loads the published, publicly-visible articles for every given category in a
 * single query and returns them grouped by category id, each list ordered as
 * the category page expects (position asc, published_at asc) and capped at
 * {@link CATEGORY_ARTICLES_CAP}. Collapses the previous one-RPC-per-subcategory
 * waterfall on the help-center category page.
 */
export async function listPublicArticlesForCategories(
  categoryIds: string[],
  viewer: Actor = ANONYMOUS_ACTOR
): Promise<Map<string, PublicCategoryArticle[]>> {
  const grouped = new Map<string, PublicCategoryArticle[]>()
  if (categoryIds.length === 0) return grouped

  // Rank within each category by the page's ordering, then keep only the first
  // CATEGORY_ARTICLES_CAP per category. Same select shape + visibility gate as
  // the single-category query so both stay in lockstep.
  const ranked = db
    .select({
      categoryId: helpCenterArticles.categoryId,
      id: helpCenterArticles.id,
      slug: helpCenterArticles.slug,
      title: helpCenterArticles.title,
      description: helpCenterArticles.description,
      position: helpCenterArticles.position,
      publishedAt: helpCenterArticles.publishedAt,
      readingTimeMinutes:
        sql<number>`GREATEST(1, ROUND(length(${helpCenterArticles.content}) / 1200.0))`.as(
          'reading_time_minutes'
        ),
      authorName: principal.displayName,
      authorAvatarUrl: principal.avatarUrl,
      rn: sql<number>`ROW_NUMBER() OVER (
        PARTITION BY ${helpCenterArticles.categoryId}
        ORDER BY ${helpCenterArticles.position} ASC, ${helpCenterArticles.publishedAt} ASC
      )`.as('rn'),
    })
    .from(helpCenterArticles)
    .innerJoin(helpCenterCategories, eq(helpCenterCategories.id, helpCenterArticles.categoryId))
    .leftJoin(principal, eq(principal.id, helpCenterArticles.principalId))
    .where(
      and(
        inArray(helpCenterArticles.categoryId, categoryIds as KbCategoryId[]),
        ...helpCenterVisibilityConditions('public', viewer)
      )
    )
    .as('ranked')

  const rows = await db
    .select({
      categoryId: ranked.categoryId,
      id: ranked.id,
      slug: ranked.slug,
      title: ranked.title,
      description: ranked.description,
      position: ranked.position,
      publishedAt: ranked.publishedAt,
      readingTimeMinutes: ranked.readingTimeMinutes,
      authorName: ranked.authorName,
      authorAvatarUrl: ranked.authorAvatarUrl,
    })
    .from(ranked)
    .where(sql`${ranked.rn} <= ${CATEGORY_ARTICLES_CAP}`)
    .orderBy(asc(ranked.categoryId), asc(ranked.position), asc(ranked.publishedAt))

  for (const row of rows) {
    const { categoryId, ...article } = row
    if (!categoryId) continue
    const list = grouped.get(categoryId) ?? []
    list.push(article as PublicCategoryArticle)
    grouped.set(categoryId, list)
  }
  return grouped
}

/**
 * Top published articles across all public categories, ranked by view count.
 * Powers the help-center homepage "Popular articles" list. Falls back to most
 * recently published on ties (e.g. a fresh install where every count is 0).
 */
export async function listPopularPublicArticles(limit: number, viewer: Actor = ANONYMOUS_ACTOR) {
  return db
    .select({
      id: helpCenterArticles.id,
      slug: helpCenterArticles.slug,
      title: helpCenterArticles.title,
      categorySlug: helpCenterCategories.slug,
      categoryName: helpCenterCategories.name,
    })
    .from(helpCenterArticles)
    .innerJoin(helpCenterCategories, eq(helpCenterCategories.id, helpCenterArticles.categoryId))
    .where(and(...helpCenterVisibilityConditions('public', viewer)))
    .orderBy(desc(helpCenterArticles.viewCount), desc(helpCenterArticles.publishedAt))
    .limit(limit)
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
    .where(
      and(
        isNotNull(helpCenterArticles.publishedAt),
        isNull(helpCenterArticles.deletedAt),
        inArray(principal.role, ['admin', 'member'])
      )
    )
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
