/**
 * Server functions for post operations
 *
 * This file consolidates all post-related operations from actions/posts.ts
 * using the new auth middleware pattern.
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
import type { TiptapContent } from '@/lib/schemas/posts'
import { requireAuth } from './auth-helpers'
import {
  listInboxPosts,
  getPostWithDetails,
  getCommentsWithReplies,
  createPost,
  updatePost,
  softDeletePost,
  changeStatus,
  restorePost,
} from '@/lib/posts/post.service'
import { dispatchPostStatusChanged } from '@/lib/events/dispatch'

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
  boardId: z.string().optional(),
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
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
          deletedAt: p.deletedAt?.toISOString() || null,
          officialResponseAt: p.officialResponseAt?.toISOString() || null,
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
      const [result, comments] = await Promise.all([
        getPostWithDetails(postId),
        getCommentsWithReplies(postId, `member:${auth.member.id}`),
      ])
      console.log(`[fn:posts] fetchPostWithDetails: found=${!!result}, comments=${comments.length}`)

      // Serialize Date fields in comments
      type SerializedComment = Omit<(typeof comments)[0], 'createdAt' | 'replies'> & {
        createdAt: string
        replies: SerializedComment[]
      }
      const serializeComment = (comment: (typeof comments)[0]): SerializedComment => ({
        ...comment,
        createdAt: comment.createdAt.toISOString(),
        replies: comment.replies.map(serializeComment),
      })

      return {
        ...result,
        createdAt: result.createdAt.toISOString(),
        updatedAt: result.updatedAt.toISOString(),
        deletedAt: result.deletedAt?.toISOString() || null,
        officialResponseAt: result.officialResponseAt?.toISOString() || null,
        comments: comments.map(serializeComment),
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
          name: auth.user.name,
          email: auth.user.email,
        }
      )
      console.log(`[fn:posts] createPostFn: id=${result.id}`)
      // Serialize Date fields
      return {
        ...result,
        createdAt: result.createdAt.toISOString(),
        updatedAt: result.updatedAt.toISOString(),
        deletedAt: result.deletedAt?.toISOString() || null,
        officialResponseAt: result.officialResponseAt?.toISOString() || null,
      }
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
        },
        {
          memberId: auth.member.id,
          name: auth.user.name,
        }
      )
      console.log(`[fn:posts] updatePostFn: updated id=${result.id}`)
      // Serialize Date fields
      return {
        ...result,
        createdAt: result.createdAt.toISOString(),
        updatedAt: result.updatedAt.toISOString(),
        deletedAt: result.deletedAt?.toISOString() || null,
        officialResponseAt: result.officialResponseAt?.toISOString() || null,
      }
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

      const result = await changeStatus(data.id as PostId, data.statusId as StatusId)

      // Dispatch post.status_changed event (fire-and-forget)
      dispatchPostStatusChanged(
        { type: 'user', userId: auth.user.id as UserId, email: auth.user.email },
        {
          id: result.id,
          title: result.title,
          boardSlug: result.boardSlug,
        },
        result.previousStatus,
        result.newStatus
      )

      console.log(`[fn:posts] changePostStatusFn: id=${data.id}, newStatus=${result.newStatus}`)
      // Serialize Date fields
      return {
        ...result,
        createdAt: result.createdAt.toISOString(),
        updatedAt: result.updatedAt.toISOString(),
        deletedAt: result.deletedAt?.toISOString() || null,
        officialResponseAt: result.officialResponseAt?.toISOString() || null,
      }
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
      // Serialize Date fields
      return {
        ...result,
        createdAt: result.createdAt.toISOString(),
        updatedAt: result.updatedAt.toISOString(),
        deletedAt: result.deletedAt?.toISOString() || null,
        officialResponseAt: result.officialResponseAt?.toISOString() || null,
      }
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
