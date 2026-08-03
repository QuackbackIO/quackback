import {
  db,
  changelogCategories,
  changelogEntries,
  changelogEntryPosts,
  changelogProducts,
  postStatuses,
  posts,
  boards,
  eq,
  and,
  isNull,
  isNotNull,
  lt,
  lte,
  or,
  desc,
  inArray,
  sql,
} from '@/lib/server/db'
import type { ChangelogCategoryId, ChangelogId, ChangelogProductId, StatusId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'
import { computeStatus } from './changelog.service'
import type { PublicChangelogEntry, PublicChangelogListResult } from './changelog.types'

const effectiveDisplayDate = sql<Date>`coalesce(${changelogEntries.displayDate}, ${changelogEntries.publishedAt})`

/**
 * Predicates that make a changelog entry publicly visible: not soft-deleted
 * and published at or before `now`. Shared by every public read path so the
 * filter stays consistent.
 */
export function publicChangelogConditions(now: Date) {
  return [
    isNull(changelogEntries.deletedAt),
    isNotNull(changelogEntries.publishedAt),
    lte(changelogEntries.publishedAt, now),
  ]
}

/**
 * Slim public lookup for link embeds: title + published date only, under the
 * same published-only visibility filter, but WITHOUT the view-count increment
 * or linked-post joins of {@link getPublicChangelogById}. An embed resolves on
 * every page render, so it must neither inflate analytics nor over-fetch.
 * Returns null (no throw) when the entry isn't publicly visible.
 */
export async function getPublicChangelogMetaById(
  id: ChangelogId
): Promise<{ id: ChangelogId; title: string; publishedAt: Date } | null> {
  const now = new Date()
  const entry = await db.query.changelogEntries.findFirst({
    where: and(eq(changelogEntries.id, id), ...publicChangelogConditions(now)),
    columns: { id: true, title: true, publishedAt: true, displayDate: true },
  })
  if (!entry || !entry.publishedAt) return null
  return {
    id: entry.id as ChangelogId,
    title: entry.title,
    publishedAt: entry.displayDate ?? entry.publishedAt,
  }
}

/**
 * Get a published changelog entry by ID for public view
 *
 * @param id - Changelog entry ID
 * @returns Public changelog entry
 */
export async function getPublicChangelogById(id: ChangelogId): Promise<PublicChangelogEntry> {
  const now = new Date()

  const entry = await db.query.changelogEntries.findFirst({
    where: and(eq(changelogEntries.id, id), ...publicChangelogConditions(now)),
  })

  if (!entry || !entry.publishedAt) {
    throw new NotFoundError(
      'CHANGELOG_NOT_FOUND',
      `Published changelog entry with ID ${id} not found`
    )
  }

  // Record the view (fire-and-forget — must never block or fail the read).
  // Same approach help-center articles use for their view counter.
  db.update(changelogEntries)
    .set({ viewCount: sql`${changelogEntries.viewCount} + 1` })
    .where(eq(changelogEntries.id, id))
    .catch(() => {})

  // Get linked posts with board slugs and status. Visibility predicates
  // run in SQL, not in JS, so we never fetch rows we'd just throw away.
  // Four independent guards, all on the WHERE clause:
  //   1. moderationState='published' — a team member can link a post in
  //      any moderation state, but pending/spam/archived/closed posts
  //      are not for public consumption.
  //   2. posts.deletedAt IS NULL — a soft-deleted post must not leak.
  //   3. boards.deletedAt IS NULL — a soft-deleted board must not leak
  //      any of its posts via the changelog.
  //   4. boards.access->>'view' = 'anonymous' — linking a team-only or
  //      segment-restricted post must not promote it into the public
  //      changelog feed. The JSON path lookup matches the pattern in
  //      apps/web/src/lib/server/policy/boards.ts.
  const linkedPostRows = await db
    .select({
      postId: posts.id,
      postTitle: posts.title,
      postVoteCount: posts.voteCount,
      postStatusId: posts.statusId,
      boardId: boards.id,
      boardSlug: boards.slug,
    })
    .from(changelogEntryPosts)
    .innerJoin(posts, eq(changelogEntryPosts.postId, posts.id))
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .where(
      and(
        eq(changelogEntryPosts.changelogEntryId, id),
        isNull(posts.deletedAt),
        eq(posts.moderationState, 'published'),
        isNull(boards.deletedAt),
        sql`${boards.access}->>'view' = 'anonymous'`
      )
    )

  // Get status info for linked posts
  const statusIds = new Set<StatusId>()
  linkedPostRows.forEach((lp) => {
    if (lp.postStatusId) statusIds.add(lp.postStatusId)
  })

  const statusMap = new Map<StatusId, { name: string; color: string }>()
  if (statusIds.size > 0) {
    const statuses = await db.query.postStatuses.findMany({
      where: inArray(postStatuses.id, Array.from(statusIds) as StatusId[]),
      columns: { id: true, name: true, color: true },
    })
    statuses.forEach((s) => statusMap.set(s.id, { name: s.name, color: s.color }))
  }

  const [category, product] = await Promise.all([
    entry.categoryId
      ? db.query.changelogCategories.findFirst({
          where: eq(changelogCategories.id, entry.categoryId),
          columns: { id: true, name: true, slug: true, color: true },
        })
      : null,
    entry.productId
      ? db.query.changelogProducts.findFirst({
          where: eq(changelogProducts.id, entry.productId),
          columns: { id: true, name: true, slug: true },
        })
      : null,
  ])

  return {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    contentJson: entry.contentJson,
    category: category ?? null,
    product: product ?? null,
    publishedAt: entry.displayDate ?? entry.publishedAt,
    linkedPosts: linkedPostRows.map((lp) => ({
      id: lp.postId,
      title: lp.postTitle,
      voteCount: lp.postVoteCount,
      boardId: lp.boardId,
      boardSlug: lp.boardSlug,
      statusId: lp.postStatusId,
      status: lp.postStatusId ? (statusMap.get(lp.postStatusId) ?? null) : null,
    })),
  }
}

/**
 * List published changelog entries for public view
 *
 * @param params - List parameters
 * @returns Paginated list of public changelog entries
 */
export async function listPublicChangelogs(params: {
  cursor?: string
  limit?: number
  entryIds?: ChangelogId[]
  categoryIds?: ChangelogCategoryId[]
  productIds?: ChangelogProductId[]
  /** Visibility restriction: only show entries with categoryId in this list (or no category). null = no restriction. */
  visibilityCategoryIds?: ChangelogCategoryId[] | null
  /** Visibility restriction: only show entries with productId in this list (or no product). null = no restriction. */
  visibilityProductIds?: ChangelogProductId[] | null
}): Promise<PublicChangelogListResult> {
  const {
    cursor,
    limit = 20,
    entryIds,
    categoryIds,
    productIds,
    visibilityCategoryIds,
    visibilityProductIds,
  } = params
  const now = new Date()

  const conditions = publicChangelogConditions(now)

  if (entryIds !== undefined) {
    if (entryIds.length === 0) return { items: [], nextCursor: null, hasMore: false }
    conditions.push(inArray(changelogEntries.id, entryIds))
  }
  if (categoryIds !== undefined) {
    if (categoryIds.length === 0) return { items: [], nextCursor: null, hasMore: false }
    conditions.push(inArray(changelogEntries.categoryId, categoryIds))
  }
  if (productIds !== undefined) {
    if (productIds.length === 0) return { items: [], nextCursor: null, hasMore: false }
    conditions.push(inArray(changelogEntries.productId, productIds))
  }

  // Visibility restrictions: always allow entries with no category/product through (null = uncategorized is always visible)
  if (visibilityCategoryIds !== null && visibilityCategoryIds !== undefined) {
    conditions.push(
      or(
        isNull(changelogEntries.categoryId),
        inArray(changelogEntries.categoryId, visibilityCategoryIds)
      )!
    )
  }
  if (visibilityProductIds !== null && visibilityProductIds !== undefined) {
    conditions.push(
      or(
        isNull(changelogEntries.productId),
        inArray(changelogEntries.productId, visibilityProductIds)
      )!
    )
  }

  // Cursor-based pagination. The lookup does NOT filter on deletedAt:
  // if an admin deleted the cursor row between page load and "Load
  // more", we still want its prior publishedAt to anchor the next page
  // so the user doesn't get duplicates / a stuck list. The main
  // results query below applies the full visibility filter, so the
  // deleted row itself stays out of the returned items.
  if (cursor) {
    const cursorEntry = await db.query.changelogEntries.findFirst({
      where: eq(changelogEntries.id, cursor as ChangelogId),
      columns: { publishedAt: true, displayDate: true },
    })
    const cursorEffective = cursorEntry?.publishedAt
      ? (cursorEntry.displayDate ?? cursorEntry.publishedAt)
      : null
    if (cursorEffective) {
      conditions.push(
        or(
          lt(effectiveDisplayDate, cursorEffective),
          and(
            sql`${effectiveDisplayDate} = ${cursorEffective}`,
            lt(changelogEntries.id, cursor as ChangelogId)
          )
        )!
      )
    }
  }

  // Fetch entries
  const entries = await db
    .select()
    .from(changelogEntries)
    .where(and(...conditions))
    .orderBy(desc(effectiveDisplayDate), desc(changelogEntries.id))
    .limit(limit + 1)

  const hasMore = entries.length > limit
  const items = hasMore ? entries.slice(0, limit) : entries

  // Get linked posts for all entries. Same four-guard filter as
  // `getPublicChangelogById` — see the comment there. Filtering happens
  // in SQL so we never materialize rows we'd just throw away.
  const itemIds = items.map((e) => e.id)
  const allLinkedPosts =
    itemIds.length > 0
      ? await db
          .select({
            changelogEntryId: changelogEntryPosts.changelogEntryId,
            postId: posts.id,
            postTitle: posts.title,
            postVoteCount: posts.voteCount,
            postStatusId: posts.statusId,
            boardId: boards.id,
            boardSlug: boards.slug,
          })
          .from(changelogEntryPosts)
          .innerJoin(posts, eq(changelogEntryPosts.postId, posts.id))
          .innerJoin(boards, eq(posts.boardId, boards.id))
          .where(
            and(
              inArray(changelogEntryPosts.changelogEntryId, itemIds),
              isNull(posts.deletedAt),
              eq(posts.moderationState, 'published'),
              isNull(boards.deletedAt),
              sql`${boards.access}->>'view' = 'anonymous'`
            )
          )
      : []

  // Group linked posts by changelog entry
  const linkedPostsMap = new Map<ChangelogId, typeof allLinkedPosts>()
  for (const lp of allLinkedPosts) {
    const existing = linkedPostsMap.get(lp.changelogEntryId) ?? []
    existing.push(lp)
    linkedPostsMap.set(lp.changelogEntryId, existing)
  }

  // Get status info for all linked posts
  const publicStatusIds = new Set<StatusId>()
  allLinkedPosts.forEach((lp) => {
    if (lp.postStatusId) publicStatusIds.add(lp.postStatusId)
  })

  const publicStatusMap = new Map<StatusId, { name: string; color: string }>()
  if (publicStatusIds.size > 0) {
    const statuses = await db.query.postStatuses.findMany({
      where: inArray(postStatuses.id, Array.from(publicStatusIds) as StatusId[]),
      columns: { id: true, name: true, color: true },
    })
    statuses.forEach((s) => publicStatusMap.set(s.id, { name: s.name, color: s.color }))
  }

  const itemCategoryIds = items
    .map((entry) => entry.categoryId)
    .filter((id): id is ChangelogCategoryId => typeof id === 'string')
  const itemProductIds = items
    .map((entry) => entry.productId)
    .filter((id): id is ChangelogProductId => typeof id === 'string')
  const [categories, products] = await Promise.all([
    itemCategoryIds.length > 0
      ? db.query.changelogCategories.findMany({
          where: inArray(changelogCategories.id, itemCategoryIds),
          columns: { id: true, name: true, slug: true, color: true },
        })
      : [],
    itemProductIds.length > 0
      ? db.query.changelogProducts.findMany({
          where: inArray(changelogProducts.id, itemProductIds),
          columns: { id: true, name: true, slug: true },
        })
      : [],
  ])
  const categoryMap = new Map(categories.map((category) => [category.id, category]))
  const productMap = new Map(products.map((product) => [product.id, product]))

  // Transform to output format (no author info for public view)
  const result: PublicChangelogEntry[] = items
    .filter((entry) => entry.publishedAt !== null)
    .map((entry) => {
      const entryLinkedPosts = linkedPostsMap.get(entry.id) ?? []
      return {
        id: entry.id,
        title: entry.title,
        content: entry.content,
        contentJson: entry.contentJson,
        category: entry.categoryId ? (categoryMap.get(entry.categoryId) ?? null) : null,
        product: entry.productId ? (productMap.get(entry.productId) ?? null) : null,
        publishedAt: entry.displayDate ?? entry.publishedAt!,
        linkedPosts: entryLinkedPosts.map((lp) => ({
          id: lp.postId,
          title: lp.postTitle,
          voteCount: lp.postVoteCount,
          boardId: lp.boardId,
          boardSlug: lp.boardSlug,
          statusId: lp.postStatusId,
          status: lp.postStatusId ? (publicStatusMap.get(lp.postStatusId) ?? null) : null,
        })),
      }
    })

  return {
    items: result,
    nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id : null,
    hasMore,
  }
}

// Re-export computeStatus for convenience (used by changelog.query.ts too)
export { computeStatus }
