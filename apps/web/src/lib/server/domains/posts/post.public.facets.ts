import { db, and, eq, sql, boards, posts, postStatuses } from '@/lib/server/db'
import { unionAll } from 'drizzle-orm/pg-core'
import type { Actor } from '@/lib/server/policy'
import { PUBLIC_FEED_VIEWS, type PublicFeedView } from '@/lib/shared/types/filters'
import { buildPostFilterConditions, type PostListParams } from './post.public'
import { feedViewCondition } from './post.public.views'

/** Counts for the portal filter panel, keyed by status slug, board slug and view. */
export interface PublicPostFacetCounts {
  statuses: Record<string, number>
  boards: Record<string, number>
  /** Null for anonymous viewers, who have no views. */
  views: Record<PublicFeedView, number> | null
}

/**
 * Facet counts for the portal feed, in one round trip. Each dimension leaves
 * out its own filter, so picking a status still shows how many posts every
 * other status holds. Visibility rules are the feed's own.
 */
export async function countPublicPostFacets(
  params: PostListParams,
  actor: Actor
): Promise<PublicPostFacetCounts> {
  const count = sql<number>`count(*)::int`
  const byStatus = db
    .select({ dimension: sql<string>`'status'`, key: postStatuses.slug, count })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .innerJoin(postStatuses, eq(posts.statusId, postStatuses.id))
    .where(and(...buildPostFilterConditions(params, actor, 'status')))
    .groupBy(postStatuses.slug)
  const byBoard = db
    .select({ dimension: sql<string>`'board'`, key: boards.slug, count })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .where(and(...buildPostFilterConditions(params, actor, 'board')))
    .groupBy(boards.slug)

  const viewer = actor.principalType === 'anonymous' ? null : actor.principalId
  const byView = viewer
    ? PUBLIC_FEED_VIEWS.map((view) =>
        db
          .select({ dimension: sql<string>`'view'`, key: sql<string>`${view}`, count })
          .from(posts)
          .innerJoin(boards, eq(posts.boardId, boards.id))
          .where(
            and(
              ...buildPostFilterConditions(params, actor, 'view'),
              feedViewCondition(view, viewer)
            )
          )
      )
    : []

  const rows = await unionAll(byStatus, byBoard, ...byView)

  const counts: PublicPostFacetCounts = {
    statuses: {},
    boards: {},
    views: viewer ? { mine: 0, voted: 0, following: 0 } : null,
  }
  for (const row of rows) {
    if (row.dimension === 'status') counts.statuses[row.key] = row.count
    else if (row.dimension === 'board') counts.boards[row.key] = row.count
    else if (counts.views) counts.views[row.key as PublicFeedView] = row.count
  }
  return counts
}
