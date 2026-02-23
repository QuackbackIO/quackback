import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import {
  type PostId,
  type PrincipalId,
  type RoadmapId,
  type StatusId,
  type TagId,
  type UserId,
} from '@quackback/ids'
import type { BoardSettings } from '@/lib/server/db'
import { getOptionalAuth, hasSessionCookie } from './auth-helpers'
import { db, principal as principalTable, user as userTable, eq, inArray } from '@/lib/server/db'
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'
import {
  listPublicBoardsWithStats,
  getPublicBoardBySlug,
} from '@/lib/server/domains/boards/board.public'
import {
  getPublicPostDetail,
  listPublicPosts,
  listPublicPostsWithVotesAndAvatars,
  getVotedPostIdsByUserId,
} from '@/lib/server/domains/posts/post.public'
import { getPostMergeInfo, getMergedPosts } from '@/lib/server/domains/posts/post.merge'
import { listPublicStatuses } from '@/lib/server/domains/statuses/status.service'
import { listPublicTags } from '@/lib/server/domains/tags/tag.service'
import { getSubscriptionStatus } from '@/lib/server/domains/subscriptions/subscription.service'
import {
  listPublicRoadmaps,
  getPublicRoadmapPosts,
} from '@/lib/server/domains/roadmaps/roadmap.service'

// Schemas
const sortSchema = z.enum(['top', 'new', 'trending'])

const fetchPublicPostsSchema = z.object({
  boardSlug: z.string().optional(),
  search: z.string().optional(),
  sort: sortSchema,
})

const fetchPortalDataSchema = z.object({
  boardSlug: z.string().optional(),
  search: z.string().optional(),
  sort: sortSchema,
  statusSlugs: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  userId: z.string().optional(),
})

export const getPrincipalIdForUser = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ userId: z.string() }))
  .handler(async ({ data }): Promise<PrincipalId | null> => {
    const record = await db.query.principal.findFirst({
      where: eq(principalTable.userId, data.userId as UserId),
    })
    return record?.id ?? null
  })

export const fetchPortalData = createServerFn({ method: 'GET' })
  .inputValidator(fetchPortalDataSchema)
  .handler(async ({ data }) => {
    // Run ALL queries in parallel for maximum performance
    // Member lookup and votes run independently alongside posts/boards/statuses/tags
    const [memberResult, boardsRaw, postsResult, statuses, tags, allVotedPosts] = await Promise.all(
      [
        // Principal lookup (needed for principalId in response)
        data.userId
          ? db.query.principal.findFirst({
              where: eq(principalTable.userId, data.userId as UserId),
              columns: { id: true },
            })
          : Promise.resolve(null),
        listPublicBoardsWithStats(),
        // Posts WITHOUT embedded vote check (we get votes separately for parallelism)
        listPublicPostsWithVotesAndAvatars({
          boardSlug: data.boardSlug,
          search: data.search,
          statusSlugs: data.statusSlugs,
          tagIds: data.tagIds as TagId[] | undefined,
          sort: data.sort,
          page: 1,
          limit: 20,
        }),
        listPublicStatuses(),
        listPublicTags(),
        // Get ALL voted post IDs for this user (runs in parallel, we'll filter to displayed posts)
        data.userId
          ? getVotedPostIdsByUserId(data.userId as UserId)
          : Promise.resolve(new Set<PostId>()),
      ]
    )
    const principalId = memberResult?.id ?? null

    // Return ALL voted post IDs (not just page 1) so infinite scroll pages show correct vote state
    const votedPostIds = Array.from(allVotedPosts)

    const posts = {
      items: postsResult.items.map((post) => ({
        id: post.id,
        title: post.title,
        content: post.content,
        statusId: post.statusId,
        voteCount: post.voteCount,
        authorName: post.authorName,
        principalId: post.principalId,
        createdAt: post.createdAt.toISOString(),
        commentCount: post.commentCount,
        tags: post.tags,
        board: post.board,
      })),
      hasMore: postsResult.hasMore,
      total: -1,
    }

    return {
      boards: boardsRaw.map((b) => ({ ...b, settings: (b.settings ?? {}) as BoardSettings })),
      posts,
      statuses,
      tags,
      votedPostIds,
      principalId,
    }
  })

export const fetchPublicBoards = createServerFn({ method: 'GET' }).handler(async () => {
  const boards = await listPublicBoardsWithStats()
  return boards.map((b) => ({ ...b, settings: (b.settings ?? {}) as BoardSettings }))
})

export const fetchPublicBoardBySlug = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    const board = await getPublicBoardBySlug(data.slug)
    if (!board) return null
    return { ...board, settings: (board.settings ?? {}) as BoardSettings }
  })

export const fetchPublicPostDetail = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ postId: z.string() }))
  .handler(async ({ data }) => {
    // Only fetch auth if user has a session cookie (for highlighting own comments)
    const principalId = hasSessionCookie() ? (await getOptionalAuth())?.principal?.id : undefined
    const result = await getPublicPostDetail(data.postId as PostId, principalId)

    if (!result) return null

    // Helper to safely convert Date or string to ISO string
    // Raw SQL may return dates as strings depending on the driver
    const toISOString = (date: Date | string): string =>
      typeof date === 'string' ? date : date.toISOString()

    type CommentType = (typeof result.comments)[0]
    type SerializedComment = Omit<CommentType, 'createdAt' | 'replies'> & {
      createdAt: string
      replies: SerializedComment[]
    }
    function serializeComment(c: CommentType): SerializedComment {
      return {
        ...c,
        createdAt: toISOString(c.createdAt),
        replies: c.replies.map(serializeComment),
      }
    }

    // Fetch merge info for this post
    const postId = data.postId as PostId
    const [mergeInfo, mergedPostsList] = await Promise.all([
      getPostMergeInfo(postId).then((info) =>
        info ? { ...info, mergedAt: toISOString(info.mergedAt) } : null
      ),
      getMergedPosts(postId),
    ])

    return {
      ...result,
      contentJson: result.contentJson ?? {},
      createdAt: toISOString(result.createdAt),
      comments: result.comments.map(serializeComment),
      mergeInfo,
      mergedPostCount: mergedPostsList.length > 0 ? mergedPostsList.length : undefined,
    }
  })

export const fetchPublicPosts = createServerFn({ method: 'GET' })
  .inputValidator(fetchPublicPostsSchema)
  .handler(async ({ data }) => {
    const result = await listPublicPosts({ ...data, page: 1, limit: 20 })
    return {
      ...result,
      items: result.items.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
    }
  })

export const fetchPublicStatuses = createServerFn({ method: 'GET' }).handler(() =>
  listPublicStatuses()
)

export const fetchPublicTags = createServerFn({ method: 'GET' }).handler(() => listPublicTags())

export const fetchUserAvatar = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({ userId: z.string(), fallbackImageUrl: z.string().nullable().optional() })
  )
  .handler(async ({ data }) => {
    const user = await db.query.user.findFirst({
      where: eq(userTable.id, data.userId as UserId),
      columns: { imageKey: true, image: true },
    })

    if (!user) return { avatarUrl: data.fallbackImageUrl ?? null, hasCustomAvatar: false }

    if (user.imageKey) {
      const avatarUrl = getPublicUrlOrNull(user.imageKey)
      if (avatarUrl) {
        return { avatarUrl, hasCustomAvatar: true }
      }
    }

    return { avatarUrl: user.image ?? data.fallbackImageUrl ?? null, hasCustomAvatar: false }
  })

export const fetchAvatars = createServerFn({ method: 'GET' })
  .inputValidator(z.array(z.string()))
  .handler(async ({ data }) => {
    const principalIds = (data as PrincipalId[]).filter((id): id is PrincipalId => id !== null)
    if (principalIds.length === 0) return {}

    const principals = await db
      .select({
        id: principalTable.id,
        avatarKey: principalTable.avatarKey,
        avatarUrl: principalTable.avatarUrl,
      })
      .from(principalTable)
      .where(inArray(principalTable.id, principalIds))

    const avatarMap = new Map<PrincipalId, string | null>()
    for (const p of principals) {
      const s3Url = p.avatarKey ? getPublicUrlOrNull(p.avatarKey) : null
      avatarMap.set(p.id, s3Url ?? p.avatarUrl)
    }
    for (const id of principalIds) {
      if (!avatarMap.has(id)) avatarMap.set(id, null)
    }

    return Object.fromEntries(avatarMap)
  })

export const fetchSubscriptionStatus = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ principalId: z.string(), postId: z.string() }))
  .handler(({ data }) =>
    getSubscriptionStatus(data.principalId as PrincipalId, data.postId as PostId)
  )

export const fetchPublicRoadmaps = createServerFn({ method: 'GET' }).handler(async () => {
  const roadmaps = await listPublicRoadmaps()
  return roadmaps.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    isPublic: r.isPublic,
    position: r.position,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }))
})

export const fetchPublicRoadmapPosts = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      roadmapId: z.string(),
      statusId: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    })
  )
  .handler(async ({ data }) => {
    const result = await getPublicRoadmapPosts(data.roadmapId as RoadmapId, {
      statusId: data.statusId as StatusId | undefined,
      limit: data.limit ?? 20,
      offset: data.offset ?? 0,
    })

    return {
      ...result,
      items: result.items.map((item) => ({
        id: String(item.id),
        title: item.title,
        voteCount: item.voteCount,
        statusId: item.statusId ? String(item.statusId) : null,
        board: { id: String(item.board.id), name: item.board.name, slug: item.board.slug },
        roadmapEntry: {
          postId: String(item.roadmapEntry.postId),
          roadmapId: String(item.roadmapEntry.roadmapId),
          position: item.roadmapEntry.position,
        },
      })),
    }
  })

export const getCommentsSectionDataFn = createServerFn({ method: 'GET' }).handler(async () => {
  // Early bailout: no session cookie = anonymous user (skip DB queries)
  if (!hasSessionCookie()) {
    return {
      isMember: false,
      canComment: false,
      user: undefined,
    }
  }

  const ctx = await getOptionalAuth()
  const isMember = !!(ctx?.user && ctx?.principal)

  return {
    isMember,
    canComment: isMember,
    user: isMember
      ? { name: ctx.user.name, email: ctx.user.email, principalId: ctx.principal.id }
      : undefined,
  }
})
