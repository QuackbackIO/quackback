import {
  db,
  and,
  eq,
  sql,
  boards,
  posts,
  postStatuses,
  postTagAssignments,
  postTags,
  type StatusCategory,
} from '@/lib/server/db'
import { unionAll } from 'drizzle-orm/pg-core'
import { fromUuid, type PostStatusId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy'
import { logger } from '@/lib/server/logger'
import {
  feedShowsActiveOnly,
  PUBLIC_FEED_VIEWS,
  type PublicFeedView,
  type PublicPostFacetCounts,
} from '@/lib/shared/types/filters'
import { buildPostFilterConditions, publicTagCondition, type PostListParams } from './post.public'
import { feedViewCondition, feedViewFor } from './post.public.views'

const log = logger.child({ component: 'post-facets' })

/** The counts are extra: if they fail, the feed still loads, without them. */
export async function countPublicPostFacetsOrNull(
  params: PostListParams,
  actor: Actor
): Promise<PublicPostFacetCounts | null> {
  try {
    return await countPublicPostFacets(params, actor)
  } catch (err) {
    log.error({ err }, 'portal feed counts failed')
    return null
  }
}

/**
 * Facet counts for the portal feed, in two passes over the visible posts: one
 * grouped by status, board and view membership, one by tag. Each dimension
 * leaves out its own filter, so picking a status still shows how many posts
 * every other status holds. Visibility rules are the feed's own.
 */
export async function countPublicPostFacets(
  params: PostListParams,
  actor: Actor
): Promise<PublicPostFacetCounts> {
  const viewer = actor.principalType === 'anonymous' ? null : actor.principalId
  const inView = (view: PublicFeedView) =>
    viewer ? sql<boolean>`(${feedViewCondition(view, viewer)})` : sql<boolean>`false`

  // Status, board and view filters are applied below, per dimension.
  const groups = db
    .select({
      tagId: sql<string | null>`null`,
      statusId: posts.statusId,
      statusSlug: postStatuses.slug,
      category: postStatuses.category,
      boardSlug: boards.slug,
      mine: inView('mine'),
      voted: inView('voted'),
      following: inView('following'),
      count: sql<number>`count(*)::int`,
    })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .leftJoin(postStatuses, eq(posts.statusId, postStatuses.id))
    .where(and(...buildPostFilterConditions(params, actor, ['status', 'board', 'view'])))
    .groupBy(sql`1, 2, 3, 4, 5, 6, 7, 8`)

  const byTag = db
    .select({
      tagId: sql<string | null>`${postTagAssignments.tagId}::text`,
      statusId: sql<PostStatusId | null>`null::uuid`,
      statusSlug: sql<string | null>`null::text`,
      category: sql<StatusCategory | null>`null::text`,
      boardSlug: sql<string>`null::text`,
      mine: sql<boolean>`false`,
      voted: sql<boolean>`false`,
      following: sql<boolean>`false`,
      count: sql<number>`count(*)::int`,
    })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .innerJoin(postTagAssignments, eq(postTagAssignments.postId, posts.id))
    .innerJoin(postTags, eq(postTags.id, postTagAssignments.tagId))
    .where(and(...buildPostFilterConditions(params, actor, ['tags']), publicTagCondition(actor)))
    .groupBy(postTagAssignments.tagId)

  const rows = await unionAll(groups, byTag)

  // Mirrors the status, board and view conditions buildPostFilterConditions
  // would have added, so each count matches the feed it leads to.
  const view = feedViewFor(params.view, actor)
  const statusInScope = (row: (typeof rows)[number], withView: PublicFeedView | undefined) => {
    if (params.statusSlugs?.length) return params.statusSlugs.includes(row.statusSlug ?? '')
    if (params.statusIds?.length) return params.statusIds.some((id) => id === row.statusId)
    if (params.portalFeed && !feedShowsActiveOnly({ search: params.search, view: withView })) {
      return true
    }
    return row.category === null || row.category === 'active'
  }
  const onBoard = (row: (typeof rows)[number]) =>
    !params.boardSlug || row.boardSlug === params.boardSlug
  const inViewRow = (row: (typeof rows)[number]) => !view || row[view]

  const counts: PublicPostFacetCounts = {
    statuses: {},
    boards: {},
    tags: {},
    total: 0,
    views: viewer ? { mine: 0, voted: 0, following: 0 } : null,
  }
  const add = (into: Record<string, number>, key: string, n: number) => {
    into[key] = (into[key] ?? 0) + n
  }
  for (const row of rows) {
    if (row.tagId !== null) {
      counts.tags[fromUuid('post_tag', row.tagId)] = row.count
      continue
    }
    const shown = statusInScope(row, view)
    if (row.statusSlug && onBoard(row) && inViewRow(row))
      add(counts.statuses, row.statusSlug, row.count)
    if (row.boardSlug && shown && inViewRow(row)) add(counts.boards, row.boardSlug, row.count)
    if (shown && onBoard(row) && inViewRow(row)) counts.total += row.count
    if (counts.views && onBoard(row)) {
      for (const each of PUBLIC_FEED_VIEWS) {
        if (row[each] && statusInScope(row, each)) add(counts.views, each, row.count)
      }
    }
  }
  return counts
}
