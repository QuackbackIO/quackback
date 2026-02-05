/**
 * Server functions for public post operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import {
  type PostId,
  type BoardId,
  type StatusId,
  type TagId,
  type MemberId,
  type RoadmapId,
  type UserId,
} from '@quackback/ids'
import { getOptionalAuth, requireAuth, hasSessionCookie } from './auth-helpers'
import { getSettings } from './workspace'
import {
  listPublicPosts,
  getAllUserVotedPostIds,
  getPublicRoadmapPostsPaginated,
  getVoteAndSubscriptionStatus,
} from '@/lib/server/domains/posts/post.public'
import { createPost } from '@/lib/server/domains/posts/post.service'
import { voteOnPost } from '@/lib/server/domains/posts/post.voting'
import {
  getPostPermissions,
  userEditPost,
  softDeletePost,
} from '@/lib/server/domains/posts/post.permissions'
import { getPublicBoardById } from '@/lib/server/domains/boards/board.public'
import { getDefaultStatus } from '@/lib/server/domains/statuses/status.service'
import { getMemberByUser } from '@/lib/server/domains/members/member.service'
import {
  listPublicRoadmaps,
  getPublicRoadmapPosts,
} from '@/lib/server/domains/roadmaps/roadmap.service'

// ============================================
// Schemas
// ============================================

const tiptapContentSchema = z.object({
  type: z.literal('doc'),
  content: z.array(z.any()).optional(),
})

const listPublicPostsSchema = z.object({
  boardSlug: z.string().optional(),
  search: z.string().optional(),
  statusIds: z.array(z.string()).optional(),
  statusSlugs: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  sort: z.enum(['top', 'new', 'trending']).optional().default('top'),
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(20),
})

const getPostPermissionsSchema = z.object({
  postId: z.string(),
})

const userEditPostSchema = z.object({
  postId: z.string(),
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().max(10000),
  contentJson: tiptapContentSchema.optional(),
})

const userDeletePostSchema = z.object({
  postId: z.string(),
})

const toggleVoteSchema = z.object({
  postId: z.string(),
})

const createPublicPostSchema = z.object({
  boardId: z.string(),
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().max(10000).optional().default(''),
  contentJson: tiptapContentSchema.optional(),
})

const getPublicRoadmapPostsSchema = z.object({
  roadmapId: z.string(),
  statusId: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
})

const getRoadmapPostsByStatusSchema = z.object({
  statusId: z.string(),
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(10),
})

const getVoteSidebarDataSchema = z.object({
  postId: z.string(),
})

// ============================================
// Type Exports
// ============================================

export type ListPublicPostsInput = z.infer<typeof listPublicPostsSchema>
export type GetPostPermissionsInput = z.infer<typeof getPostPermissionsSchema>
export type UserEditPostInput = z.infer<typeof userEditPostSchema>
export type UserDeletePostInput = z.infer<typeof userDeletePostSchema>
export type ToggleVoteInput = z.infer<typeof toggleVoteSchema>
export type CreatePublicPostInput = z.infer<typeof createPublicPostSchema>
export type GetPublicRoadmapPostsInput = z.infer<typeof getPublicRoadmapPostsSchema>
export type GetRoadmapPostsByStatusInput = z.infer<typeof getRoadmapPostsByStatusSchema>
export type GetVoteSidebarDataInput = z.infer<typeof getVoteSidebarDataSchema>

// ============================================
// Server Functions
// ============================================

/**
 * List public posts with filtering (no auth required).
 */
export const listPublicPostsFn = createServerFn({ method: 'GET' })
  .inputValidator(listPublicPostsSchema)
  .handler(async ({ data }: { data: ListPublicPostsInput }) => {
    console.log(
      `[fn:public-posts] listPublicPostsFn: sort=${data.sort}, board=${data.boardSlug || 'all'}`
    )
    try {
      // No auth needed - this is public data
      const result = await listPublicPosts({
        boardSlug: data.boardSlug,
        search: data.search,
        statusIds: data.statusIds as StatusId[] | undefined,
        statusSlugs: data.statusSlugs,
        tagIds: data.tagIds as TagId[] | undefined,
        sort: data.sort,
        page: data.page,
        limit: data.limit,
      })

      console.log(`[fn:public-posts] listPublicPostsFn: count=${result.items.length}`)
      // Serialize Date fields
      return {
        ...result,
        items: result.items.map((post) => ({
          ...post,
          createdAt: post.createdAt.toISOString(),
        })),
      }
    } catch (error) {
      console.error(`[fn:public-posts] ❌ listPublicPostsFn failed:`, error)
      throw error
    }
  })

/**
 * Get edit/delete permissions for a post (optional auth).
 */
export const getPostPermissionsFn = createServerFn({ method: 'GET' })
  .inputValidator(getPostPermissionsSchema)
  .handler(
    async ({
      data,
    }: {
      data: GetPostPermissionsInput
    }): Promise<{
      canEdit: boolean
      canDelete: boolean
      editReason?: string
      deleteReason?: string
    }> => {
      console.log(`[fn:public-posts] getPostPermissionsFn: postId=${data.postId}`)
      try {
        // Early bailout: no session cookie = no permissions (skip DB queries)
        if (!hasSessionCookie()) {
          console.log(`[fn:public-posts] getPostPermissionsFn: no session cookie, skipping auth`)
          return { canEdit: false, canDelete: false }
        }

        const ctx = await getOptionalAuth()
        const postId = data.postId as PostId

        // If no user/member, return no permissions
        if (!ctx?.user || !ctx?.member) {
          console.log(`[fn:public-posts] getPostPermissionsFn: no auth context`)
          return { canEdit: false, canDelete: false }
        }

        // Build actor info for permission checks
        const actor = {
          memberId: ctx.member.id,
          role: ctx.member.role,
        }

        // Combined permission check - queries post, config, and status only once
        const { canEdit, canDelete } = await getPostPermissions(postId, actor)

        console.log(
          `[fn:public-posts] getPostPermissionsFn: canEdit=${canEdit.allowed}, canDelete=${canDelete.allowed}`
        )
        return {
          canEdit: canEdit.allowed,
          canDelete: canDelete.allowed,
          editReason: canEdit.reason,
          deleteReason: canDelete.reason,
        }
      } catch (error) {
        // Post not found or other error - return no permissions
        console.error(`[fn:public-posts] ❌ getPostPermissionsFn failed:`, error)
        return { canEdit: false, canDelete: false }
      }
    }
  )

/**
 * User edits their own post.
 */
export const userEditPostFn = createServerFn({ method: 'POST' })
  .inputValidator(userEditPostSchema)
  .handler(async ({ data }: { data: UserEditPostInput }) => {
    console.log(`[fn:public-posts] userEditPostFn: postId=${data.postId}`)
    try {
      const ctx = await requireAuth()
      const { postId: postIdRaw, title, content, contentJson } = data
      const postId = postIdRaw as PostId

      // Build actor info for permission check
      const actor = {
        memberId: ctx.member.id,
        role: ctx.member.role,
      }

      const result = await userEditPost(postId, { title, content, contentJson }, actor)

      console.log(`[fn:public-posts] userEditPostFn: edited id=${result.id}`)
      // Serialize Date fields
      return {
        ...result,
        createdAt: result.createdAt.toISOString(),
        updatedAt: result.updatedAt.toISOString(),
        deletedAt: result.deletedAt?.toISOString() || null,
        officialResponseAt: result.officialResponseAt?.toISOString() || null,
      }
    } catch (error) {
      console.error(`[fn:public-posts] ❌ userEditPostFn failed:`, error)
      throw error
    }
  })

/**
 * User soft-deletes their own post.
 */
export const userDeletePostFn = createServerFn({ method: 'POST' })
  .inputValidator(userDeletePostSchema)
  .handler(async ({ data }: { data: UserDeletePostInput }) => {
    console.log(`[fn:public-posts] userDeletePostFn: postId=${data.postId}`)
    try {
      const ctx = await requireAuth()
      const postId = data.postId as PostId

      // Build actor info for permission check
      const actor = {
        memberId: ctx.member.id,
        role: ctx.member.role,
      }

      await softDeletePost(postId, actor)

      console.log(`[fn:public-posts] userDeletePostFn: deleted id=${postId}`)
      return { id: postId }
    } catch (error) {
      console.error(`[fn:public-posts] ❌ userDeletePostFn failed:`, error)
      throw error
    }
  })

/**
 * Toggle vote on a post. Requires authentication.
 */
export const toggleVoteFn = createServerFn({ method: 'POST' })
  .inputValidator(toggleVoteSchema)
  .handler(
    async ({ data }: { data: ToggleVoteInput }): Promise<{ voted: boolean; voteCount: number }> => {
      console.log(`[fn:public-posts] toggleVoteFn: postId=${data.postId}`)
      try {
        const ctx = await requireAuth()
        const result = await voteOnPost(data.postId as PostId, ctx.member.id)
        console.log(
          `[fn:public-posts] toggleVoteFn: voted=${result.voted}, count=${result.voteCount}`
        )
        return result
      } catch (error) {
        console.error(`[fn:public-posts] ❌ toggleVoteFn failed:`, error)
        throw error
      }
    }
  )

/**
 * Create a post on a public board.
 */
export const createPublicPostFn = createServerFn({ method: 'POST' })
  .inputValidator(createPublicPostSchema)
  .handler(async ({ data }: { data: CreatePublicPostInput }) => {
    console.log(`[fn:public-posts] createPublicPostFn: boardId=${data.boardId}`)
    try {
      const ctx = await requireAuth()
      const { boardId: boardIdRaw, title, content, contentJson } = data
      const boardId = boardIdRaw as BoardId

      // Run all independent lookups in parallel (board, member, defaultStatus, settings)
      const [board, memberRecord, defaultStatus, settings] = await Promise.all([
        getPublicBoardById(boardId),
        getMemberByUser(ctx.user.id as UserId),
        getDefaultStatus(),
        getSettings(),
      ])

      // Validate results
      if (!board || !board.isPublic) {
        throw new Error('Board not found')
      }
      if (!memberRecord) {
        throw new Error('You must be a member to submit feedback.')
      }
      if (!settings) {
        throw new Error('Organization settings not found')
      }

      // Build author info
      const author = {
        memberId: memberRecord.id as MemberId,
        userId: ctx.user.id as UserId,
        name: ctx.user.name || ctx.user.email,
        email: ctx.user.email,
      }

      // Create the post (events dispatched by service layer)
      const post = await createPost(
        {
          boardId,
          title,
          content,
          contentJson,
          statusId: defaultStatus?.id,
        },
        author
      )

      console.log(`[fn:public-posts] createPublicPostFn: id=${post.id}`)
      return {
        id: post.id,
        title: post.title,
        content: post.content,
        statusId: post.statusId,
        voteCount: post.voteCount,
        createdAt: post.createdAt.toISOString(),
        board: {
          id: board.id,
          name: board.name,
          slug: board.slug,
        },
      }
    } catch (error) {
      console.error(`[fn:public-posts] ❌ createPublicPostFn failed:`, error)
      throw error
    }
  })

/**
 * Get all post IDs the user has voted on (optional auth).
 */
export const getVotedPostsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ votedPostIds: string[] }> => {
    console.log(`[fn:public-posts] getVotedPostsFn`)
    try {
      // Early bailout: no session cookie = no votes (skip DB queries)
      if (!hasSessionCookie()) {
        console.log(`[fn:public-posts] getVotedPostsFn: no session cookie, skipping auth`)
        return { votedPostIds: [] }
      }

      const ctx = await getOptionalAuth()

      // Optional auth - return empty if not authenticated
      if (!ctx?.user || !ctx?.member) {
        console.log(`[fn:public-posts] getVotedPostsFn: no auth`)
        return { votedPostIds: [] }
      }

      const result = await getAllUserVotedPostIds(ctx.member.id)

      console.log(`[fn:public-posts] getVotedPostsFn: count=${result.size}`)
      return { votedPostIds: Array.from(result) }
    } catch (error) {
      console.error(`[fn:public-posts] ❌ getVotedPostsFn failed:`, error)
      throw error
    }
  }
)

/**
 * List public roadmaps for a workspace (no auth required).
 */
export const listPublicRoadmapsFn = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:public-posts] listPublicRoadmapsFn`)
  try {
    // No auth needed - this is public data
    const result = await listPublicRoadmaps()

    console.log(`[fn:public-posts] listPublicRoadmapsFn: count=${result.length}`)
    // Serialize branded types to plain strings for turbo-stream
    return result.map((roadmap) => ({
      id: String(roadmap.id),
      name: roadmap.name,
      slug: roadmap.slug,
      description: roadmap.description,
      isPublic: roadmap.isPublic,
      position: roadmap.position,
      createdAt: roadmap.createdAt.toISOString(),
      updatedAt: roadmap.updatedAt.toISOString(),
    }))
  } catch (error) {
    console.error(`[fn:public-posts] ❌ listPublicRoadmapsFn failed:`, error)
    throw error
  }
})

/**
 * Get posts for a public roadmap (no auth required).
 */
export const getPublicRoadmapPostsFn = createServerFn({ method: 'GET' })
  .inputValidator(getPublicRoadmapPostsSchema)
  .handler(async ({ data }: { data: GetPublicRoadmapPostsInput }) => {
    console.log(`[fn:public-posts] getPublicRoadmapPostsFn: roadmapId=${data.roadmapId}`)
    try {
      // No auth needed - this is public data
      const { roadmapId, statusId, limit, offset } = data

      const result = await getPublicRoadmapPosts(roadmapId as RoadmapId, {
        statusId: statusId as StatusId | undefined,
        limit,
        offset,
      })
      console.log(`[fn:public-posts] getPublicRoadmapPostsFn: count=${result.items.length}`)

      // Serialize branded types to plain strings for turbo-stream
      return {
        ...result,
        items: result.items.map((item) => ({
          id: String(item.id),
          title: item.title,
          voteCount: item.voteCount,
          statusId: item.statusId ? String(item.statusId) : null,
          board: {
            id: String(item.board.id),
            name: item.board.name,
            slug: item.board.slug,
          },
          roadmapEntry: {
            postId: String(item.roadmapEntry.postId),
            roadmapId: String(item.roadmapEntry.roadmapId),
            position: item.roadmapEntry.position,
          },
        })),
      }
    } catch (error) {
      console.error(`[fn:public-posts] ❌ getPublicRoadmapPostsFn failed:`, error)
      throw error
    }
  })

/**
 * Get paginated posts for roadmap view filtered by status (legacy).
 */
export const getRoadmapPostsByStatusFn = createServerFn({ method: 'GET' })
  .inputValidator(getRoadmapPostsByStatusSchema)
  .handler(async ({ data }: { data: GetRoadmapPostsByStatusInput }) => {
    console.log(`[fn:public-posts] getRoadmapPostsByStatusFn: statusId=${data.statusId}`)
    try {
      // No auth needed - this is public data
      const { statusId, page, limit } = data

      const result = await getPublicRoadmapPostsPaginated({
        statusId: statusId as StatusId,
        page,
        limit,
      })
      console.log(`[fn:public-posts] getRoadmapPostsByStatusFn: count=${result.items.length}`)

      // Serialize branded types to plain strings for turbo-stream
      return {
        ...result,
        items: result.items.map((item) => ({
          ...item,
          statusId: item.statusId ? String(item.statusId) : null,
        })),
      }
    } catch (error) {
      console.error(`[fn:public-posts] ❌ getRoadmapPostsByStatusFn failed:`, error)
      throw error
    }
  })

/**
 * Get vote sidebar data for a post (optional auth).
 * Returns membership status, vote status, and subscription status.
 */
export const getVoteSidebarDataFn = createServerFn({ method: 'GET' })
  .inputValidator(getVoteSidebarDataSchema)
  .handler(async ({ data }) => {
    const startTime = Date.now()
    console.log(`[fn:public-posts] getVoteSidebarDataFn: postId=${data.postId}`)
    try {
      // Early bailout: no session cookie = anonymous user (skip all DB queries)
      if (!hasSessionCookie()) {
        console.log(
          `[fn:public-posts] getVoteSidebarDataFn: no session cookie, returning defaults (${Date.now() - startTime}ms)`
        )
        return {
          isMember: false,
          hasVoted: false,
          subscriptionStatus: {
            subscribed: false,
            level: 'none' as const,
            reason: null,
          },
        }
      }

      const ctx = await getOptionalAuth()
      const postId = data.postId as PostId
      console.log(
        `[fn:public-posts] getVoteSidebarDataFn: auth resolved in ${Date.now() - startTime}ms`
      )

      // No authenticated user (invalid/expired session)
      if (!ctx?.user || !ctx?.member) {
        console.log(
          `[fn:public-posts] getVoteSidebarDataFn: no auth context (${Date.now() - startTime}ms)`
        )
        return {
          isMember: false,
          hasVoted: false,
          subscriptionStatus: {
            subscribed: false,
            level: 'none' as const,
            reason: null,
          },
        }
      }

      // Authenticated user - fetch vote and subscription data in a single query
      const { hasVoted, subscription } = await getVoteAndSubscriptionStatus(postId, ctx.member.id)

      console.log(
        `[fn:public-posts] getVoteSidebarDataFn: isMember=true, hasVoted=${hasVoted}, total=${Date.now() - startTime}ms`
      )
      return {
        isMember: true,
        hasVoted,
        subscriptionStatus: {
          subscribed: subscription.subscribed,
          level: subscription.level,
          reason: subscription.reason,
        },
      }
    } catch (error) {
      const elapsed = Date.now() - startTime
      const errorName = error instanceof Error ? error.name : 'Unknown'
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.error(
        `[fn:public-posts] ❌ getVoteSidebarDataFn failed after ${elapsed}ms: ${errorName}: ${errorMsg}`
      )
      throw error
    }
  })

// ============================================
// Similar Posts (Duplicate Detection)
// ============================================

const findSimilarPostsSchema = z.object({
  title: z.string().min(3).max(200),
  limit: z.number().int().min(1).max(10).optional().default(5),
})

/** Match strength categories for similar posts */
export type MatchStrength = 'strong' | 'good' | 'weak'

export interface SimilarPost {
  id: string
  title: string
  voteCount: number
  status: {
    name: string
    color: string
  } | null
  boardSlug: string
  /** How closely this matches the search (strong: 50%+, good: 40-50%, weak: 35-40%) */
  matchStrength: MatchStrength
}

/** Categorize similarity score into match strength */
function getMatchStrength(score: number): MatchStrength {
  if (score >= 0.5) return 'strong'
  if (score >= 0.4) return 'good'
  return 'weak'
}

/** Raw search result before enrichment */
interface RawSearchResult {
  id: string
  title: string
  voteCount: number
  statusId: string | null
  boardId: string
  score: number
}

/** Convert database row to raw result */
function toRawResult(row: {
  id: PostId | string
  title: string
  voteCount: number
  statusId: StatusId | string | null
  boardId: BoardId | string
  score: number
}): RawSearchResult {
  return {
    id: String(row.id),
    title: row.title,
    voteCount: row.voteCount,
    statusId: row.statusId ? String(row.statusId) : null,
    boardId: String(row.boardId),
    score: Number(row.score),
  }
}

/**
 * Find posts similar to the given title using hybrid search.
 * Combines semantic (vector) and keyword (full-text) search for best results.
 *
 * The vector search handles synonyms naturally through embeddings - the model
 * knows that "dark mode" ≈ "night theme" without needing explicit dictionaries.
 * FTS provides a boost for exact keyword matches.
 *
 * No auth required - this is a read-only helper for the post creation form.
 */
export const findSimilarPostsFn = createServerFn({ method: 'GET' })
  .inputValidator(findSimilarPostsSchema)
  .handler(async ({ data }): Promise<SimilarPost[]> => {
    console.log(`[fn:public-posts] findSimilarPostsFn: title="${data.title.slice(0, 30)}..."`)
    try {
      const { db, posts, boards, postStatuses, and, isNull, desc, sql, inArray } =
        await import('@/lib/server/db')
      const { generateEmbedding } = await import('@/lib/server/domains/embeddings')
      const { isAIEnabled } = await import('@/lib/server/domains/ai/config')

      const searchQuery = data.title.trim()
      const limit = data.limit ?? 5
      const fetchLimit = limit * 2 // Fetch more for merging

      // Run hybrid search: vector + full-text IN PARALLEL
      // FTS runs immediately while embedding is generated (network call)
      const ftsPromise = db
        .select({
          id: posts.id,
          title: posts.title,
          voteCount: posts.voteCount,
          statusId: posts.statusId,
          boardId: posts.boardId,
          score:
            sql<number>`ts_rank(${posts.searchVector}, plainto_tsquery('english', ${searchQuery}))`.as(
              'score'
            ),
        })
        .from(posts)
        .where(
          and(
            isNull(posts.deletedAt),
            sql`${posts.searchVector} @@ plainto_tsquery('english', ${searchQuery})`
          )
        )
        .orderBy(
          desc(sql`ts_rank(${posts.searchVector}, plainto_tsquery('english', ${searchQuery}))`),
          desc(posts.voteCount)
        )
        .limit(fetchLimit)

      // Vector search: embedding generation + vector query
      const vectorPromise = (async (): Promise<RawSearchResult[]> => {
        if (!isAIEnabled()) return []
        try {
          const embedding = await generateEmbedding(searchQuery)
          if (!embedding) return []

          const vectorStr = `[${embedding.join(',')}]`
          const matches = await db
            .select({
              id: posts.id,
              title: posts.title,
              voteCount: posts.voteCount,
              statusId: posts.statusId,
              boardId: posts.boardId,
              score: sql<number>`1 - (${posts.embedding} <=> ${vectorStr}::vector)`.as('score'),
            })
            .from(posts)
            .where(
              and(
                isNull(posts.deletedAt),
                sql`${posts.embedding} IS NOT NULL`,
                sql`1 - (${posts.embedding} <=> ${vectorStr}::vector) >= 0.35`
              )
            )
            .orderBy(desc(sql`1 - (${posts.embedding} <=> ${vectorStr}::vector)`))
            .limit(fetchLimit)

          console.log(`[fn:public-posts] Vector search found ${matches.length} results`)
          return matches.map(toRawResult)
        } catch (error) {
          console.warn(`[fn:public-posts] Vector search failed, using full-text only:`, error)
          return []
        }
      })()

      // Wait for both searches in parallel
      const [ftsMatches, vectorResults] = await Promise.all([ftsPromise, vectorPromise])

      // Normalize FTS score to 0-1 range (ts_rank typically returns 0-0.5)
      const ftsResults = ftsMatches.map((r) => ({
        ...toRawResult(r),
        score: Math.min(Number(r.score) * 2, 1),
      }))
      console.log(`[fn:public-posts] Full-text search found ${ftsResults.length} results`)

      // 3. Merge results (dedupe by ID, combine scores)
      const scoreMap = new Map<
        string,
        { result: RawSearchResult; vectorScore: number; ftsScore: number }
      >()

      for (const r of vectorResults) {
        scoreMap.set(r.id, { result: r, vectorScore: r.score, ftsScore: 0 })
      }

      for (const r of ftsResults) {
        const existing = scoreMap.get(r.id)
        if (existing) {
          existing.ftsScore = r.score
        } else {
          scoreMap.set(r.id, { result: r, vectorScore: 0, ftsScore: r.score })
        }
      }

      // Calculate hybrid score: boost when both searches match
      const merged = Array.from(scoreMap.values())
        .map(({ result, vectorScore, ftsScore }) => {
          const score = ftsScore > 0 ? Math.min(vectorScore + ftsScore * 0.3, 1) : vectorScore
          return { ...result, score }
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)

      console.log(`[fn:public-posts] Hybrid search merged ${merged.length} results`)

      if (merged.length === 0) {
        console.log(`[fn:public-posts] findSimilarPostsFn: no matches found`)
        return []
      }

      // Fetch status and board info for matched posts
      const statusIds = [
        ...new Set(merged.filter((r) => r.statusId).map((r) => r.statusId!)),
      ] as StatusId[]
      const boardIds = [...new Set(merged.map((r) => r.boardId))] as BoardId[]

      const [statusesResult, boardsResult] = await Promise.all([
        statusIds.length > 0
          ? db
              .select({ id: postStatuses.id, name: postStatuses.name, color: postStatuses.color })
              .from(postStatuses)
              .where(inArray(postStatuses.id, statusIds))
          : Promise.resolve([]),
        db
          .select({ id: boards.id, slug: boards.slug })
          .from(boards)
          .where(inArray(boards.id, boardIds)),
      ])

      const statusMap = new Map(statusesResult.map((s) => [String(s.id), s]))
      const boardMap = new Map(boardsResult.map((b) => [String(b.id), b]))

      // Build response
      const similarPosts: SimilarPost[] = merged.map((post) => {
        const status = post.statusId ? statusMap.get(post.statusId) : null
        const board = boardMap.get(post.boardId)

        return {
          id: post.id,
          title: post.title,
          voteCount: post.voteCount,
          status: status ? { name: status.name, color: status.color } : null,
          boardSlug: board?.slug ?? '',
          matchStrength: getMatchStrength(post.score),
        }
      })

      console.log(`[fn:public-posts] findSimilarPostsFn: found ${similarPosts.length} matches`)
      return similarPosts
    } catch (error) {
      console.error(`[fn:public-posts] ❌ findSimilarPostsFn failed:`, error)
      return []
    }
  })
