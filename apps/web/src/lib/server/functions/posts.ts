/**
 * Server functions for post operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import {
  type PostId,
  type BoardId,
  type StatusId,
  type TagId,
  type MemberId,
  type UserId,
} from '@quackback/ids'
import type { TiptapContent } from '@/lib/shared/schemas/posts'
import { requireAuth } from './auth-helpers'
import { createPost, updatePost } from '@/lib/server/domains/posts/post.service'
import {
  listInboxPosts,
  getPostWithDetails,
  getCommentsWithReplies,
} from '@/lib/server/domains/posts/post.query'
import { changeStatus } from '@/lib/server/domains/posts/post.status'
import { softDeletePost, restorePost } from '@/lib/server/domains/posts/post.permissions'
import { hasUserVoted } from '@/lib/server/domains/posts/post.public'

// ============================================
// Helpers
// ============================================

/**
 * Safely convert a date value to ISO string.
 * Handles both Date objects and ISO strings (Neon HTTP driver returns strings).
 */
function toIsoString(value: Date | string): string {
  if (typeof value === 'string') {
    return value // Already an ISO string
  }
  return value.toISOString()
}

/**
 * Safely convert an optional date value to ISO string or null.
 */
function toIsoStringOrNull(value: Date | string | null | undefined): string | null {
  if (value == null) {
    return null
  }
  return toIsoString(value)
}

/**
 * Serialize common post date fields for API responses.
 */
function serializePostDates<
  T extends {
    createdAt: Date | string
    updatedAt: Date | string
    deletedAt?: Date | string | null
    officialResponseAt?: Date | string | null
  },
>(
  post: T
): Omit<T, 'createdAt' | 'updatedAt' | 'deletedAt' | 'officialResponseAt'> & {
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  officialResponseAt: string | null
} {
  return {
    ...post,
    createdAt: toIsoString(post.createdAt),
    updatedAt: toIsoString(post.updatedAt),
    deletedAt: toIsoStringOrNull(post.deletedAt),
    officialResponseAt: toIsoStringOrNull(post.officialResponseAt),
  }
}

// ============================================
// Schemas
// ============================================

const tiptapContentSchema = z.object({
  type: z.literal('doc'),
  content: z.array(z.any()).optional(),
})

const listInboxPostsSchema = z.object({
  boardIds: z.array(z.string()).optional(),
  statusIds: z.array(z.string()).optional(),
  statusSlugs: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  ownerId: z.union([z.string(), z.null()]).optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  minVotes: z.number().int().min(0).optional(),
  sort: z.enum(['newest', 'oldest', 'votes']).optional().default('newest'),
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(20),
})

const createPostSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().min(1, 'Description is required').max(10000),
  contentJson: tiptapContentSchema.optional(),
  boardId: z.string(),
  statusId: z.string().optional(),
  tagIds: z.array(z.string()).optional().default([]),
})

const getPostSchema = z.object({
  id: z.string(),
})

const updatePostSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(10000).optional(),
  contentJson: tiptapContentSchema.optional(),
  ownerId: z.string().nullable().optional(),
  officialResponse: z.string().max(5000).nullable().optional(),
})

const deletePostSchema = z.object({
  id: z.string(),
})

const changeStatusSchema = z.object({
  id: z.string(),
  statusId: z.string(),
})

const updateTagsSchema = z.object({
  id: z.string(),
  tagIds: z.array(z.string()),
})

const restorePostSchema = z.object({
  id: z.string(),
})

// ============================================
// Type Exports
// ============================================

export type ListInboxPostsInput = z.infer<typeof listInboxPostsSchema>
export type CreatePostInput = z.infer<typeof createPostSchema>
export type GetPostInput = z.infer<typeof getPostSchema>
export type UpdatePostInput = z.infer<typeof updatePostSchema>
export type DeletePostInput = z.infer<typeof deletePostSchema>
export type ChangeStatusInput = z.infer<typeof changeStatusSchema>
export type UpdateTagsInput = z.infer<typeof updateTagsSchema>
export type RestorePostInput = z.infer<typeof restorePostSchema>

// ============================================
// Read Operations
// ============================================

/**
 * List inbox posts with filtering, sorting, and pagination
 */
export const fetchInboxPostsForAdmin = createServerFn({ method: 'GET' })
  .inputValidator(listInboxPostsSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:posts] fetchInboxPostsForAdmin`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const result = await listInboxPosts({
        boardIds: data.boardIds as BoardId[] | undefined,
        statusIds: data.statusIds as StatusId[] | undefined,
        statusSlugs: data.statusSlugs,
        tagIds: data.tagIds as TagId[] | undefined,
        ownerId: data.ownerId as MemberId | null | undefined,
        search: data.search,
        dateFrom: data.dateFrom ? new Date(data.dateFrom) : undefined,
        dateTo: data.dateTo ? new Date(data.dateTo) : undefined,
        minVotes: data.minVotes,
        sort: data.sort,
        page: data.page,
        limit: data.limit,
      })
      console.log(
        `[fn:posts] fetchInboxPostsForAdmin: count=${result.items.length}, page=${data.page}`
      )
      return {
        ...result,
        items: result.items.map((p) => ({
          ...p,
          contentJson: (p.contentJson ?? {}) as TiptapContent,
          createdAt: toIsoString(p.createdAt),
          updatedAt: toIsoString(p.updatedAt),
          deletedAt: toIsoStringOrNull(p.deletedAt),
          officialResponseAt: toIsoStringOrNull(p.officialResponseAt),
        })),
      }
    } catch (error) {
      console.error(`[fn:posts] ❌ fetchInboxPostsForAdmin failed:`, error)
      throw error
    }
  })

/**
 * Get a single post with full details including comments
 */
export const fetchPostWithDetails = createServerFn({ method: 'GET' })
  .inputValidator(getPostSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:posts] fetchPostWithDetails: id=${data.id}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member'] })

      const postId = data.id as PostId

      const [result, comments, voted] = await Promise.all([
        getPostWithDetails(postId),
        getCommentsWithReplies(postId, auth.member.id),
        hasUserVoted(postId, auth.member.id),
      ])
      console.log(
        `[fn:posts] fetchPostWithDetails: found=${!!result}, comments=${comments.length}, hasVoted=${voted}`
      )

      // Serialize Date fields in comments
      type SerializedComment = Omit<(typeof comments)[0], 'createdAt' | 'replies'> & {
        createdAt: string
        replies: SerializedComment[]
      }
      const serializeComment = (comment: (typeof comments)[0]): SerializedComment => ({
        ...comment,
        createdAt: toIsoString(comment.createdAt),
        replies: comment.replies.map(serializeComment),
      })

      // Serialize pinned comment dates
      const serializedPinnedComment = result.pinnedComment
        ? {
            ...result.pinnedComment,
            createdAt: toIsoString(result.pinnedComment.createdAt),
          }
        : null

      return {
        ...serializePostDates(result),
        hasVoted: voted,
        comments: comments.map(serializeComment),
        pinnedComment: serializedPinnedComment,
      }
    } catch (error) {
      console.error(`[fn:posts] ❌ fetchPostWithDetails failed:`, error)
      throw error
    }
  })

// ============================================
// Write Operations
// ============================================

/**
 * Create a new post
 */
export const createPostFn = createServerFn({ method: 'POST' })
  .inputValidator(createPostSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:posts] createPostFn: boardId=${data.boardId}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member'] })

      const result = await createPost(
        {
          title: data.title,
          content: data.content,
          contentJson: data.contentJson,
          boardId: data.boardId as BoardId,
          statusId: data.statusId as StatusId | undefined,
          tagIds: data.tagIds as TagId[] | undefined,
        },
        {
          memberId: auth.member.id,
          userId: auth.user.id as UserId,
          name: auth.user.name,
          email: auth.user.email,
        }
      )
      console.log(`[fn:posts] createPostFn: id=${result.id}`)

      // Events are now dispatched by the service layer

      return serializePostDates(result)
    } catch (error) {
      console.error(`[fn:posts] ❌ createPostFn failed:`, error)
      throw error
    }
  })

/**
 * Update an existing post
 */
export const updatePostFn = createServerFn({ method: 'POST' })
  .inputValidator(updatePostSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:posts] updatePostFn: id=${data.id}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member'] })

      const result = await updatePost(
        data.id as PostId,
        {
          title: data.title,
          content: data.content,
          contentJson: data.contentJson,
          ownerMemberId: data.ownerId as MemberId | null | undefined,
          officialResponse: data.officialResponse,
        },
        {
          memberId: auth.member.id,
          name: auth.user.name,
        }
      )
      console.log(`[fn:posts] updatePostFn: updated id=${result.id}`)
      return serializePostDates(result)
    } catch (error) {
      console.error(`[fn:posts] ❌ updatePostFn failed:`, error)
      throw error
    }
  })

/**
 * Delete a post (soft delete)
 */
export const deletePostFn = createServerFn({ method: 'POST' })
  .inputValidator(deletePostSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:posts] deletePostFn: id=${data.id}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member'] })

      await softDeletePost(data.id as PostId, {
        memberId: auth.member.id,
        role: auth.member.role,
      })
      console.log(`[fn:posts] deletePostFn: deleted id=${data.id}`)
      return { id: data.id }
    } catch (error) {
      console.error(`[fn:posts] ❌ deletePostFn failed:`, error)
      throw error
    }
  })

/**
 * Change post status
 */
export const changePostStatusFn = createServerFn({ method: 'POST' })
  .inputValidator(changeStatusSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:posts] changePostStatusFn: id=${data.id}, statusId=${data.statusId}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member'] })

      const result = await changeStatus(data.id as PostId, data.statusId as StatusId, {
        userId: auth.user.id as UserId,
        email: auth.user.email,
      })

      // Events are dispatched by the service layer

      console.log(`[fn:posts] changePostStatusFn: id=${data.id}, newStatus=${result.newStatus}`)
      return serializePostDates(result)
    } catch (error) {
      console.error(`[fn:posts] ❌ changePostStatusFn failed:`, error)
      throw error
    }
  })

/**
 * Restore a deleted post
 */
export const restorePostFn = createServerFn({ method: 'POST' })
  .inputValidator(restorePostSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:posts] restorePostFn: id=${data.id}`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const result = await restorePost(data.id as PostId)
      console.log(`[fn:posts] restorePostFn: restored id=${result.id}`)
      return serializePostDates(result)
    } catch (error) {
      console.error(`[fn:posts] ❌ restorePostFn failed:`, error)
      throw error
    }
  })

/**
 * Update post tags
 */
export const updatePostTagsFn = createServerFn({ method: 'POST' })
  .inputValidator(updateTagsSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:posts] updatePostTagsFn: id=${data.id}, tagCount=${data.tagIds.length}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member'] })

      await updatePost(
        data.id as PostId,
        {
          tagIds: data.tagIds as TagId[],
        },
        {
          memberId: auth.member.id,
          name: auth.user.name,
        }
      )
      console.log(`[fn:posts] updatePostTagsFn: updated id=${data.id}`)
      return { id: data.id }
    } catch (error) {
      console.error(`[fn:posts] ❌ updatePostTagsFn failed:`, error)
      throw error
    }
  })
