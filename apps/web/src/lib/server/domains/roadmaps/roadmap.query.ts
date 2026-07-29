import {
  db,
  eq,
  and,
  isNull,
  inArray,
  asc,
  desc,
  gte,
  lt,
  sql,
  roadmaps,
  roadmapColumns,
  posts,
  postTagAssignments,
  boards,
  userSegments,
  type Roadmap,
} from '@/lib/server/db'
import { type RoadmapId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { ANONYMOUS_ACTOR, boardViewFilter, canViewRoadmap, type Actor } from '@/lib/server/policy'
import {
  parseRoadmapDateBucket,
  roadmapBaseFilterSchema,
  roadmapDateBucketsBetween,
  type RoadmapBaseFilter,
  type RoadmapDateBucket,
} from '@/lib/shared/roadmap-config'
import type { SQL } from 'drizzle-orm'
import type {
  RoadmapPostsListResult,
  RoadmapPostsQueryOptions,
  RoadmapWithColumns,
} from './roadmap.types'

function parseBaseFilter(roadmap: Roadmap): RoadmapBaseFilter {
  const parsed = roadmapBaseFilterSchema.safeParse(roadmap.baseFilter)
  if (!parsed.success) {
    throw new ValidationError('INVALID_ROADMAP_FILTER', 'Roadmap base filter is invalid')
  }
  return parsed.data as RoadmapBaseFilter
}

function addDimensionConditions(conditions: SQL[], filter: RoadmapBaseFilter): void {
  if (filter.statusIds?.length) conditions.push(inArray(posts.statusId, filter.statusIds))
  if (filter.boardIds?.length) conditions.push(inArray(posts.boardId, filter.boardIds))
  if (filter.tagIds?.length) {
    conditions.push(
      inArray(
        posts.id,
        db
          .selectDistinct({ postId: postTagAssignments.postId })
          .from(postTagAssignments)
          .where(inArray(postTagAssignments.tagId, filter.tagIds))
      )
    )
  }
  if (filter.segmentIds?.length) {
    conditions.push(
      inArray(
        posts.principalId,
        db
          .select({ principalId: userSegments.principalId })
          .from(userSegments)
          .where(inArray(userSegments.segmentId, filter.segmentIds))
      )
    )
  }
}

function membershipConditions(
  roadmap: RoadmapWithColumns,
  options: RoadmapPostsQueryOptions
): SQL[] {
  const conditions: SQL[] = []
  addDimensionConditions(conditions, parseBaseFilter(roadmap))

  if (roadmap.type === 'column') {
    const configuredStatusIds = roadmap.columns.map((column) => column.statusId)
    if (options.statusId) {
      conditions.push(
        configuredStatusIds.includes(options.statusId)
          ? eq(posts.statusId, options.statusId)
          : sql`false`
      )
    } else {
      conditions.push(
        configuredStatusIds.length ? inArray(posts.statusId, configuredStatusIds) : sql`false`
      )
    }
  } else if (options.bucketId) {
    const bucket = parseRoadmapDateBucket(options.bucketId, roadmap.frequency ?? 'monthly')
    if (!bucket) {
      throw new ValidationError('INVALID_ROADMAP_BUCKET', 'Invalid roadmap date bucket')
    }
    if (bucket.noEta) {
      conditions.push(isNull(posts.eta))
    } else {
      conditions.push(gte(posts.eta, new Date(bucket.start!)))
      conditions.push(lt(posts.eta, new Date(bucket.end!)))
    }
  }

  return conditions
}

function runtimeFilterConditions(options: RoadmapPostsQueryOptions): SQL[] {
  const conditions: SQL[] = []
  if (options.search) {
    conditions.push(
      sql`${posts.searchVector} @@ websearch_to_tsquery('english', ${options.search})`
    )
  }
  addDimensionConditions(conditions, {
    boardIds: options.boardIds,
    tagIds: options.tagIds,
    segmentIds: options.segmentIds,
  })
  return conditions
}

function sortFor(options: RoadmapPostsQueryOptions): SQL {
  if (options.sort === 'newest') return desc(posts.createdAt)
  if (options.sort === 'oldest') return asc(posts.createdAt)
  return desc(posts.voteCount)
}

async function loadRoadmap(roadmapId: RoadmapId): Promise<RoadmapWithColumns> {
  const roadmap = await db.query.roadmaps.findFirst({
    where: and(eq(roadmaps.id, roadmapId), isNull(roadmaps.deletedAt)),
    with: { columns: { orderBy: [asc(roadmapColumns.position)] } },
  })
  if (!roadmap) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${roadmapId} not found`)
  }
  return roadmap
}

async function queryRoadmapPosts(
  roadmap: RoadmapWithColumns,
  options: RoadmapPostsQueryOptions,
  publicActor?: Actor
): Promise<RoadmapPostsListResult> {
  const { limit = 20, offset = 0 } = options
  const conditions: SQL[] = [isNull(posts.deletedAt), isNull(posts.canonicalPostId)]
  if (publicActor) {
    conditions.push(eq(posts.moderationState, 'published'), boardViewFilter(publicActor))
  } else {
    conditions.push(isNull(boards.deletedAt))
  }
  conditions.push(...membershipConditions(roadmap, options), ...runtimeFilterConditions(options))
  const orderBy = sortFor(options)

  const [results, countResult] = await Promise.all([
    db
      .select({
        post: {
          id: posts.id,
          title: posts.title,
          voteCount: posts.voteCount,
          commentCount: posts.commentCount,
          statusId: posts.statusId,
          eta: posts.eta,
        },
        board: { id: boards.id, name: boards.name, slug: boards.slug },
      })
      .from(posts)
      .innerJoin(boards, eq(posts.boardId, boards.id))
      .where(and(...conditions))
      .orderBy(orderBy, desc(posts.createdAt), asc(posts.id))
      .limit(limit + 1)
      .offset(offset),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(posts)
      .innerJoin(boards, eq(posts.boardId, boards.id))
      .where(and(...conditions)),
  ])

  const hasMore = results.length > limit
  return {
    items: (hasMore ? results.slice(0, limit) : results).map((result) => ({
      ...result.post,
      board: result.board,
    })),
    total: Number(countResult[0]?.count ?? 0),
    hasMore,
  }
}

export async function getRoadmapPosts(
  roadmapId: RoadmapId,
  options: RoadmapPostsQueryOptions
): Promise<RoadmapPostsListResult> {
  return queryRoadmapPosts(await loadRoadmap(roadmapId), options)
}

export async function getPublicRoadmapPosts(
  roadmapId: RoadmapId,
  options: RoadmapPostsQueryOptions,
  actor: Actor = ANONYMOUS_ACTOR
): Promise<RoadmapPostsListResult> {
  const roadmap = await loadRoadmap(roadmapId)
  if (!canViewRoadmap(actor, roadmap).allowed) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${roadmapId} not found`)
  }
  return queryRoadmapPosts(roadmap, options, actor)
}

async function dateBucketsFor(roadmapId: RoadmapId, actor?: Actor): Promise<RoadmapDateBucket[]> {
  const roadmap = await loadRoadmap(roadmapId)
  if (roadmap.type !== 'date') return []
  if (actor && !canViewRoadmap(actor, roadmap).allowed) {
    throw new NotFoundError('ROADMAP_NOT_FOUND', `Roadmap with ID ${roadmapId} not found`)
  }

  const conditions: SQL[] = [isNull(posts.deletedAt), isNull(posts.canonicalPostId)]
  if (actor) {
    conditions.push(eq(posts.moderationState, 'published'), boardViewFilter(actor))
  } else {
    conditions.push(isNull(boards.deletedAt))
  }
  addDimensionConditions(conditions, parseBaseFilter(roadmap))

  const [bounds] = await db
    .select({
      minEta: sql<Date | null>`MIN(${posts.eta})`,
      maxEta: sql<Date | null>`MAX(${posts.eta})`,
    })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .where(and(...conditions))

  return roadmapDateBucketsBetween(
    roadmap.frequency ?? 'monthly',
    bounds?.minEta ?? null,
    bounds?.maxEta ?? null
  )
}

export function getRoadmapDateBuckets(roadmapId: RoadmapId): Promise<RoadmapDateBucket[]> {
  return dateBucketsFor(roadmapId)
}

export function getPublicRoadmapDateBuckets(
  roadmapId: RoadmapId,
  actor: Actor = ANONYMOUS_ACTOR
): Promise<RoadmapDateBucket[]> {
  return dateBucketsFor(roadmapId, actor)
}
