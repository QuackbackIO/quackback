/**
 * Server functions for post operations
 *
 * This file consolidates all post-related operations from actions/posts.ts
 * using the new auth middleware pattern.
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from './auth-helpers'
import {
  createPost,
  updatePost,
  listInboxPosts,
  getPostWithDetails,
  changeStatus,
  softDeletePost,
  restorePost,
} from '@/lib/posts'
import {
  postIdSchema,
  boardIdSchema,
  statusIdSchema,
  tagIdSchema,
  memberIdSchema,
  type PostId,
  type BoardId,
  type StatusId,
  type TagId,
  type MemberId,
  type UserId,
} from '@quackback/ids'
import type { TiptapContent } from '@/lib/schemas/posts'
import { dispatchPostStatusChanged } from '@/lib/events/dispatch'

// ============================================
// Schemas
// ============================================

const tiptapContentSchema = z.object({
  type: z.literal('doc'),
  content: z.array(z.any()).optional(),
})

const listInboxPostsSchema = z.object({
  boardIds: z.array(boardIdSchema).optional(),
  statusIds: z.array(statusIdSchema).optional(),
  statusSlugs: z.array(z.string()).optional(),
  tagIds: z.array(tagIdSchema).optional(),
  ownerId: z.union([memberIdSchema, z.null()]).optional(),
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
  boardId: boardIdSchema,
  statusId: statusIdSchema.optional(),
  tagIds: z.array(tagIdSchema).optional().default([]),
})

const getPostSchema = z.object({
  id: postIdSchema,
})

const updatePostSchema = z.object({
  id: postIdSchema,
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(10000).optional(),
  contentJson: tiptapContentSchema.optional(),
  boardId: boardIdSchema.optional(),
  ownerId: memberIdSchema.nullable().optional(),
  officialResponse: z.string().max(5000).nullable().optional(),
})

const deletePostSchema = z.object({
  id: postIdSchema,
})

const changeStatusSchema = z.object({
  id: postIdSchema,
  statusId: statusIdSchema,
})

const updateTagsSchema = z.object({
  id: postIdSchema,
  tagIds: z.array(tagIdSchema),
})

const restorePostSchema = z.object({
  id: postIdSchema,
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
  .handler(async ({ data }: { data: ListInboxPostsInput }) => {
    await requireAuth({ roles: ['owner', 'admin', 'member'] })

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
    if (!result.success) {
      throw new Error(result.error.message)
    }
    return {
      ...result.value,
      items: result.value.items.map((p) => ({
        ...p,
        contentJson: (p.contentJson ?? {}) as TiptapContent,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
        deletedAt: p.deletedAt?.toISOString() || null,
        officialResponseAt: p.officialResponseAt?.toISOString() || null,
      })),
    }
  })

/**
 * Get a single post with full details
 */
export const fetchPostWithDetails = createServerFn({ method: 'GET' })
  .inputValidator(getPostSchema)
  .handler(async ({ data }: { data: GetPostInput }) => {
    await requireAuth({ roles: ['owner', 'admin', 'member'] })

    const result = await getPostWithDetails(data.id as PostId)
    if (!result.success) {
      throw new Error(result.error.message)
    }
    // Serialize Date fields
    return {
      ...result.value,
      createdAt: result.value.createdAt.toISOString(),
      updatedAt: result.value.updatedAt.toISOString(),
      deletedAt: result.value.deletedAt?.toISOString() || null,
      officialResponseAt: result.value.officialResponseAt?.toISOString() || null,
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
  .handler(async ({ data }: { data: CreatePostInput }) => {
    const auth = await requireAuth({ roles: ['owner', 'admin', 'member'] })

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
    if (!result.success) {
      throw new Error(result.error.message)
    }
    // Serialize Date fields
    return {
      ...result.value,
      createdAt: result.value.createdAt.toISOString(),
      updatedAt: result.value.updatedAt.toISOString(),
      deletedAt: result.value.deletedAt?.toISOString() || null,
      officialResponseAt: result.value.officialResponseAt?.toISOString() || null,
    }
  })

/**
 * Update an existing post
 */
export const updatePostFn = createServerFn({ method: 'POST' })
  .inputValidator(updatePostSchema)
  .handler(async ({ data }: { data: UpdatePostInput }) => {
    const auth = await requireAuth({ roles: ['owner', 'admin', 'member'] })

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
    if (!result.success) {
      throw new Error(result.error.message)
    }
    // Serialize Date fields
    return {
      ...result.value,
      createdAt: result.value.createdAt.toISOString(),
      updatedAt: result.value.updatedAt.toISOString(),
      deletedAt: result.value.deletedAt?.toISOString() || null,
      officialResponseAt: result.value.officialResponseAt?.toISOString() || null,
    }
  })

/**
 * Delete a post (soft delete)
 */
export const deletePostFn = createServerFn({ method: 'POST' })
  .inputValidator(deletePostSchema)
  .handler(async ({ data }: { data: DeletePostInput }) => {
    const auth = await requireAuth({ roles: ['owner', 'admin', 'member'] })

    const result = await softDeletePost(data.id as PostId, {
      memberId: auth.member.id,
      role: auth.member.role,
    })
    if (!result.success) {
      throw new Error(result.error.message)
    }
    return { id: data.id }
  })

/**
 * Change post status
 */
export const changePostStatusFn = createServerFn({ method: 'POST' })
  .inputValidator(changeStatusSchema)
  .handler(async ({ data }: { data: ChangeStatusInput }) => {
    const auth = await requireAuth({ roles: ['owner', 'admin', 'member'] })

    const result = await changeStatus(data.id as PostId, data.statusId as StatusId)
    if (!result.success) {
      throw new Error(result.error.message)
    }

    // Dispatch post.status_changed event (fire-and-forget)
    dispatchPostStatusChanged(
      { type: 'user', userId: auth.user.id as UserId, email: auth.user.email },
      {
        id: result.value.id,
        title: result.value.title,
        boardSlug: result.value.boardSlug,
      },
      result.value.previousStatus,
      result.value.newStatus
    )

    // Serialize Date fields
    return {
      ...result.value,
      createdAt: result.value.createdAt.toISOString(),
      updatedAt: result.value.updatedAt.toISOString(),
      deletedAt: result.value.deletedAt?.toISOString() || null,
      officialResponseAt: result.value.officialResponseAt?.toISOString() || null,
    }
  })

/**
 * Restore a deleted post
 */
export const restorePostFn = createServerFn({ method: 'POST' })
  .inputValidator(restorePostSchema)
  .handler(async ({ data }: { data: RestorePostInput }) => {
    await requireAuth({ roles: ['owner', 'admin', 'member'] })

    const result = await restorePost(data.id as PostId)
    if (!result.success) {
      throw new Error(result.error.message)
    }
    // Serialize Date fields
    return {
      ...result.value,
      createdAt: result.value.createdAt.toISOString(),
      updatedAt: result.value.updatedAt.toISOString(),
      deletedAt: result.value.deletedAt?.toISOString() || null,
      officialResponseAt: result.value.officialResponseAt?.toISOString() || null,
    }
  })

/**
 * Update post tags
 */
export const updatePostTagsFn = createServerFn({ method: 'POST' })
  .inputValidator(updateTagsSchema)
  .handler(async ({ data }: { data: UpdateTagsInput }) => {
    const auth = await requireAuth({ roles: ['owner', 'admin', 'member'] })

    const result = await updatePost(
      data.id as PostId,
      {
        tagIds: data.tagIds as TagId[],
      },
      {
        memberId: auth.member.id,
        name: auth.user.name,
      }
    )
    if (!result.success) {
      throw new Error(result.error.message)
    }
    return { id: data.id }
  })
