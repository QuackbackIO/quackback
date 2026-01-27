import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import {
  type PostId,
  type MemberId,
  type RoadmapId,
  type StatusId,
  type UserId,
} from '@quackback/ids'
import type { BoardSettings } from '@quackback/db/types'
import { getOptionalAuth } from './auth-helpers'
import { db, member as memberTable, user as userTable, eq, inArray } from '@/lib/db'
import { listPublicBoardsWithStats, getPublicBoardBySlug } from '@/lib/boards/board.public'
import {
  getPublicPostDetail,
  listPublicPosts,
  listPublicPostsWithVotesAndAvatars,
  getVotedPostIdsByUserId,
} from '@/lib/posts/post.public'
import { listPublicStatuses } from '@/lib/statuses/status.service'
import { listPublicTags } from '@/lib/tags/tag.service'
import { getSubscriptionStatus } from '@/lib/subscriptions/subscription.service'
import { listPublicRoadmaps, getPublicRoadmapPosts } from '@/lib/roadmaps/roadmap.service'

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
  userId: z.string().optional(),
})

export const getMemberIdForUser = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ userId: z.string() }))
  .handler(async ({ data }): Promise<MemberId | null> => {
    const member = await db.query.member.findFirst({
      where: eq(memberTable.userId, data.userId as UserId),
    })
    return member?.id ?? null
  })

export const fetchPortalData = createServerFn({ method: 'GET' })
  .inputValidator(fetchPortalDataSchema)
  .handler(async ({ data }) => {
    // Run ALL queries in parallel for maximum performance
    // Member lookup and votes run independently alongside posts/boards/statuses/tags
    const [memberResult, boardsRaw, postsResult, statuses, tags, allVotedPosts] = await Promise.all(
      [
        // Member lookup (needed for memberId in response)
        data.userId
          ? db.query.member.findFirst({
              where: eq(memberTable.userId, data.userId as UserId),
              columns: { id: true },
            })
          : Promise.resolve(null),
        listPublicBoardsWithStats(),
        // Posts WITHOUT embedded vote check (we get votes separately for parallelism)
        listPublicPostsWithVotesAndAvatars({
          boardSlug: data.boardSlug,
          search: data.search,
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
    const memberId = memberResult?.id ?? null

    const avatarMap: Record<string, string | null> = {}
    const votedPostIds: string[] = []

    const posts = {
      items: postsResult.items.map((post) => {
        if (post.memberId && post.avatarUrl !== undefined) {
          avatarMap[post.memberId] = post.avatarUrl
        }
        // Check if this post is in the user's voted set
        if (allVotedPosts.has(post.id)) {
          votedPostIds.push(post.id)
        }
        return {
          id: post.id,
          title: post.title,
          content: post.content,
          statusId: post.statusId,
          voteCount: post.voteCount,
          authorName: post.authorName,
          memberId: post.memberId,
          createdAt: post.createdAt.toISOString(),
          commentCount: post.commentCount,
          tags: post.tags,
          board: post.board,
        }
      }),
      hasMore: postsResult.hasMore,
      total: -1,
    }

    return {
      boards: boardsRaw.map((b) => ({ ...b, settings: (b.settings ?? {}) as BoardSettings })),
      posts,
      statuses,
      tags,
      votedPostIds,
      avatars: avatarMap,
      memberId,
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
    const ctx = await getOptionalAuth()
    const result = await getPublicPostDetail(data.postId as PostId, ctx?.member?.id)

    if (!result) return null

    type CommentType = (typeof result.comments)[0]
    type SerializedComment = Omit<CommentType, 'createdAt' | 'replies'> & {
      createdAt: string
      replies: SerializedComment[]
    }
    function serializeComment(c: CommentType): SerializedComment {
      return {
        ...c,
        createdAt: c.createdAt.toISOString(),
        replies: c.replies.map(serializeComment),
      }
    }

    return {
      ...result,
      contentJson: result.contentJson ?? {},
      createdAt: result.createdAt.toISOString(),
      comments: result.comments.map(serializeComment),
      officialResponse: result.officialResponse
        ? {
            ...result.officialResponse,
            respondedAt: result.officialResponse.respondedAt.toISOString(),
          }
        : null,
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
      columns: { imageBlob: true, imageType: true, image: true },
    })

    if (!user) return { avatarUrl: data.fallbackImageUrl ?? null, hasCustomAvatar: false }

    if (user.imageBlob && user.imageType) {
      return {
        avatarUrl: `data:${user.imageType};base64,${Buffer.from(user.imageBlob).toString('base64')}`,
        hasCustomAvatar: true,
      }
    }

    return { avatarUrl: user.image ?? data.fallbackImageUrl ?? null, hasCustomAvatar: false }
  })

export const fetchAvatars = createServerFn({ method: 'GET' })
  .inputValidator(z.array(z.string()))
  .handler(async ({ data }) => {
    const memberIds = (data as MemberId[]).filter((id): id is MemberId => id !== null)
    if (memberIds.length === 0) return {}

    const members = await db
      .select({
        memberId: memberTable.id,
        imageBlob: userTable.imageBlob,
        imageType: userTable.imageType,
        image: userTable.image,
      })
      .from(memberTable)
      .innerJoin(userTable, eq(memberTable.userId, userTable.id))
      .where(inArray(memberTable.id, memberIds))

    const avatarMap = new Map<MemberId, string | null>()
    for (const m of members) {
      avatarMap.set(
        m.memberId,
        m.imageBlob && m.imageType
          ? `data:${m.imageType};base64,${Buffer.from(m.imageBlob).toString('base64')}`
          : m.image
      )
    }
    for (const id of memberIds) {
      if (!avatarMap.has(id)) avatarMap.set(id, null)
    }

    return Object.fromEntries(avatarMap)
  })

export const fetchSubscriptionStatus = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ memberId: z.string(), postId: z.string() }))
  .handler(({ data }) => getSubscriptionStatus(data.memberId as MemberId, data.postId as PostId))

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
  const ctx = await getOptionalAuth()
  const isMember = !!(ctx?.user && ctx?.member)

  return {
    isMember,
    canComment: isMember,
    user: isMember
      ? { name: ctx.user.name, email: ctx.user.email, memberId: ctx.member.id }
      : undefined,
  }
})
