import {
  db,
  eq,
  and,
  isNull,
  inArray,
  asc,
  desc,
  sql,
  roadmaps,
  posts,
  postRoadmaps,
  postTags,
  boards,
  userSegments,
  type Roadmap,
} from '@/lib/server/db'
import { type RoadmapId, type PostId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'
import type { RoadmapPostsListResult, RoadmapPostsQueryOptions } from './roadmap.types'

/** Build filter conditions and sort order for roadmap post queries */
function buildRoadmapFilterConditions(
  options: RoadmapPostsQueryOptions,
  baseConditions: ReturnType<typeof eq>[]
) {
  const conditions = [...baseConditions]

  if (options.search) {
    conditions.push(
      sql`${posts.searchVector} @@ websearch_to_tsquery('english', ${options.search})`
    )
  }

  if (options.boardIds && options.boardIds.length > 0) {
    conditions.push(inArray(posts.boardId, options.boardIds))
  }

  if (options.tagIds && options.tagIds.length > 0) {
    conditions.push(
      inArray(
        posts.id,
        db
          .selectDistinct({ postId: postTags.postId })
          .from(postTags)
          .where(inArray(postTags.tagId, options.tagIds))
      )
    )
  }

  if (options.segmentIds && options.segmentIds.length > 0) {
    conditions.push(
      inArray(
        posts.principalId,
        db
          .select({ principalId: userSegments.principalId })
          .from(userSegments)
          .where(inArray(userSegments.segmentId, options.segmentIds))
      )
    )
  }

  let orderBy
  switch (options.sort) {
    case 'newest':
      orderBy = desc(posts.createdAt)
      break
    case 'oldest':
      orderBy = asc(posts.createdAt)
      break
    default:
      orderBy = desc(posts.voteCount)
      break
  }

  return { conditions, orderBy }
}

/**
 * Get posts for a roadmap, optionally filtered by status
 */
export async function getRoadmapPosts(
  roadmapId: RoadmapId,
  options: RoadmapPostsQueryOptions
): Promise<RoadmapPostsListResult> {
  // Verify roadmap exists
  const roadmap = await db.query.roadmaps.findFirst({ where: eq(roadmaps.id, roadmapId) })
  if (!roadmap) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${roadmapId} not found`)
  }

  const { statusId, limit = 20, offset = 0 } = options

  // Build base conditions + filter conditions
  const baseConditions: ReturnType<typeof eq>[] = [
    eq(postRoadmaps.roadmapId, roadmapId),
    isNull(posts.deletedAt),
  ]
  if (statusId) {
    baseConditions.push(eq(posts.statusId, statusId))
  }
  const { conditions, orderBy } = buildRoadmapFilterConditions(options, baseConditions)

  // Run data and count queries in parallel
  const [results, countResult] = await Promise.all([
    db
      .select({
        post: {
          id: posts.id,
          title: posts.title,
          voteCount: posts.voteCount,
          statusId: posts.statusId,
        },
        board: {
          id: boards.id,
          name: boards.name,
          slug: boards.slug,
        },
        roadmapEntry: postRoadmaps,
      })
      .from(postRoadmaps)
      .innerJoin(posts, eq(postRoadmaps.postId, posts.id))
      .innerJoin(boards, eq(posts.boardId, boards.id))
      .where(and(...conditions))
      .orderBy(orderBy)
      .limit(limit + 1)
      .offset(offset),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(postRoadmaps)
      .innerJoin(posts, eq(postRoadmaps.postId, posts.id))
      .where(and(...conditions)),
  ])

  // Check if there are more
  const hasMore = results.length > limit
  const items = hasMore ? results.slice(0, limit) : results
  const total = Number(countResult[0]?.count ?? 0)

  return {
    items: items.map((r) => ({
      id: r.post.id,
      title: r.post.title,
      voteCount: r.post.voteCount,
      statusId: r.post.statusId,
      board: r.board,
      roadmapEntry: r.roadmapEntry,
    })),
    total,
    hasMore,
  }
}

/**
 * Get public roadmap posts (no auth required)
 */
export async function getPublicRoadmapPosts(
  roadmapId: RoadmapId,
  options: RoadmapPostsQueryOptions
): Promise<RoadmapPostsListResult> {
  // Verify roadmap exists and is public
  const roadmap = await db.query.roadmaps.findFirst({ where: eq(roadmaps.id, roadmapId) })
  if (!roadmap) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${roadmapId} not found`)
  }
  if (!roadmap.isPublic) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${roadmapId} not found`)
  }

  const { statusId, limit = 20, offset = 0 } = options

  // Build base conditions + filter conditions
  const baseConditions: ReturnType<typeof eq>[] = [
    eq(postRoadmaps.roadmapId, roadmapId),
    isNull(posts.deletedAt),
  ]
  if (statusId) {
    baseConditions.push(eq(posts.statusId, statusId))
  }
  const { conditions, orderBy } = buildRoadmapFilterConditions(options, baseConditions)

  // Run data and count queries in parallel
  const [results, countResult] = await Promise.all([
    db
      .select({
        post: {
          id: posts.id,
          title: posts.title,
          voteCount: posts.voteCount,
          statusId: posts.statusId,
        },
        board: {
          id: boards.id,
          name: boards.name,
          slug: boards.slug,
        },
        roadmapEntry: postRoadmaps,
      })
      .from(postRoadmaps)
      .innerJoin(posts, eq(postRoadmaps.postId, posts.id))
      .innerJoin(boards, eq(posts.boardId, boards.id))
      .where(and(...conditions))
      .orderBy(orderBy)
      .limit(limit + 1)
      .offset(offset),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(postRoadmaps)
      .innerJoin(posts, eq(postRoadmaps.postId, posts.id))
      .where(and(...conditions)),
  ])

  const hasMore = results.length > limit
  const items = hasMore ? results.slice(0, limit) : results
  const total = Number(countResult[0]?.count ?? 0)

  return {
    items: items.map((r) => ({
      id: r.post.id,
      title: r.post.title,
      voteCount: r.post.voteCount,
      statusId: r.post.statusId,
      board: r.board,
      roadmapEntry: r.roadmapEntry,
    })),
    total,
    hasMore,
  }
}

/**
 * Get all roadmaps a post belongs to
 */
export async function getPostRoadmaps(postId: PostId): Promise<Roadmap[]> {
  const entries = await db
    .select({ roadmap: roadmaps })
    .from(postRoadmaps)
    .innerJoin(roadmaps, eq(postRoadmaps.roadmapId, roadmaps.id))
    .where(eq(postRoadmaps.postId, postId))
    .orderBy(asc(roadmaps.position))

  return entries.map((e) => e.roadmap)
}
