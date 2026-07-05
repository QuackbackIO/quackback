import {
  db,
  changelogEntries,
  changelogEntryPosts,
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
import type { ChangelogId, PostStatusId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'
import { computeStatus } from './changelog.service'
import { getCategoriesForEntries, categoryGateAllows } from './changelog-category.service'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
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
 * @param actor - Viewer, for the category segment gate (defaults anonymous)
 * @returns Public changelog entry
 */
export async function getPublicChangelogById(
  id: ChangelogId,
  actor: Actor = ANONYMOUS_ACTOR
): Promise<PublicChangelogEntry> {
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

  // Category segment gate: same NotFoundError shape as a genuinely missing
  // entry, so a gated entry can't be distinguished from one that doesn't exist.
  const categoriesMap = await getCategoriesForEntries([id])
  const categories = categoriesMap.get(id) ?? []
  if (!categoryGateAllows(categories, actor)) {
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
  const statusIds = new Set<PostStatusId>()
  linkedPostRows.forEach((lp) => {
    if (lp.postStatusId) statusIds.add(lp.postStatusId)
  })

  const statusMap = new Map<PostStatusId, { name: string; color: string }>()
  if (statusIds.size > 0) {
    const statuses = await db.query.postStatuses.findMany({
      where: inArray(postStatuses.id, Array.from(statusIds) as PostStatusId[]),
      columns: { id: true, name: true, color: true },
    })
    statuses.forEach((s) => statusMap.set(s.id, { name: s.name, color: s.color }))
  }

  return {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    contentJson: entry.contentJson,
    publishedAt: entry.displayDate ?? entry.publishedAt,
    categories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    linkedPosts: linkedPostRows.map((lp) => ({
      id: lp.postId,
      title: lp.postTitle,
      voteCount: lp.postVoteCount,
      boardSlug: lp.boardSlug,
      status: lp.postStatusId ? (statusMap.get(lp.postStatusId) ?? null) : null,
    })),
  }
}

/**
 * List published changelog entries for public view
 *
 * @param params - List parameters
 * @param actor - Viewer, for the category segment gate (defaults anonymous)
 * @returns Paginated list of public changelog entries
 */
export async function listPublicChangelogs(
  params: {
    cursor?: string
    limit?: number
  },
  actor: Actor = ANONYMOUS_ACTOR
): Promise<PublicChangelogListResult> {
  const { cursor, limit = 20 } = params
  const now = new Date()

  const conditions = publicChangelogConditions(now)

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
  const entryIds = items.map((e) => e.id)
  const allLinkedPosts =
    entryIds.length > 0
      ? await db
          .select({
            changelogEntryId: changelogEntryPosts.changelogEntryId,
            postId: posts.id,
            postTitle: posts.title,
            postVoteCount: posts.voteCount,
            postStatusId: posts.statusId,
            boardSlug: boards.slug,
          })
          .from(changelogEntryPosts)
          .innerJoin(posts, eq(changelogEntryPosts.postId, posts.id))
          .innerJoin(boards, eq(posts.boardId, boards.id))
          .where(
            and(
              inArray(changelogEntryPosts.changelogEntryId, entryIds),
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
  const publicStatusIds = new Set<PostStatusId>()
  allLinkedPosts.forEach((lp) => {
    if (lp.postStatusId) publicStatusIds.add(lp.postStatusId)
  })

  const publicStatusMap = new Map<PostStatusId, { name: string; color: string }>()
  if (publicStatusIds.size > 0) {
    const statuses = await db.query.postStatuses.findMany({
      where: inArray(postStatuses.id, Array.from(publicStatusIds) as PostStatusId[]),
      columns: { id: true, name: true, color: true },
    })
    statuses.forEach((s) => publicStatusMap.set(s.id, { name: s.name, color: s.color }))
  }

  // Category segment gate. Applied as a display-time filter over the
  // already-paginated page (not a SQL predicate) — cheap given a workspace's
  // changelog volume, and it keeps the cursor anchored on the underlying
  // publish ordering rather than reshuffling pagination around a rare gate.
  const categoriesByEntry = await getCategoriesForEntries(entryIds)

  // Transform to output format (no author info for public view)
  const result: PublicChangelogEntry[] = items
    .filter((entry) => entry.publishedAt !== null)
    .filter((entry) => categoryGateAllows(categoriesByEntry.get(entry.id) ?? [], actor))
    .map((entry) => {
      const entryLinkedPosts = linkedPostsMap.get(entry.id) ?? []
      const entryCategories = categoriesByEntry.get(entry.id) ?? []
      return {
        id: entry.id,
        title: entry.title,
        content: entry.content,
        contentJson: entry.contentJson,
        publishedAt: entry.displayDate ?? entry.publishedAt!,
        categories: entryCategories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
        linkedPosts: entryLinkedPosts.map((lp) => ({
          id: lp.postId,
          title: lp.postTitle,
          voteCount: lp.postVoteCount,
          boardSlug: lp.boardSlug,
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
