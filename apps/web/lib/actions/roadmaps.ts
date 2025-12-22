'use server'

import { z } from 'zod'
import { withAction, mapDomainError } from './with-action'
import { actionOk, actionErr } from './types'
import { getRoadmapService } from '@/lib/services'
import {
  roadmapIdSchema,
  postIdSchema,
  statusIdSchema,
  isValidTypeId,
  type RoadmapId,
  type PostId,
  type StatusId,
} from '@quackback/ids'

// ============================================
// Schemas
// ============================================

const listRoadmapsSchema = z.object({})

const createRoadmapSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or less'),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase with hyphens'),
  description: z.string().max(500, 'Description must be 500 characters or less').optional(),
  isPublic: z.boolean().optional(),
})

const getRoadmapSchema = z.object({
  id: roadmapIdSchema,
})

const updateRoadmapSchema = z.object({
  id: roadmapIdSchema,
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  isPublic: z.boolean().optional(),
})

const deleteRoadmapSchema = z.object({
  id: roadmapIdSchema,
})

const reorderRoadmapsSchema = z.object({
  roadmapIds: z.array(z.string()).min(1, 'At least one roadmap ID is required'),
})

const getRoadmapPostsSchema = z.object({
  roadmapId: roadmapIdSchema,
  statusId: statusIdSchema.optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
})

const addPostToRoadmapSchema = z.object({
  roadmapId: roadmapIdSchema,
  postId: postIdSchema,
})

const removePostFromRoadmapSchema = z.object({
  roadmapId: roadmapIdSchema,
  postId: postIdSchema,
})

const reorderRoadmapPostsSchema = z.object({
  roadmapId: roadmapIdSchema,
  postIds: z.array(z.string()).min(1, 'At least one post ID is required'),
})

// ============================================
// Type Exports
// ============================================

export type ListRoadmapsInput = z.infer<typeof listRoadmapsSchema>
export type CreateRoadmapInput = z.infer<typeof createRoadmapSchema>
export type GetRoadmapInput = z.infer<typeof getRoadmapSchema>
export type UpdateRoadmapInput = z.infer<typeof updateRoadmapSchema>
export type DeleteRoadmapInput = z.infer<typeof deleteRoadmapSchema>
export type ReorderRoadmapsInput = z.infer<typeof reorderRoadmapsSchema>
export type GetRoadmapPostsInput = z.infer<typeof getRoadmapPostsSchema>
export type AddPostToRoadmapInput = z.infer<typeof addPostToRoadmapSchema>
export type RemovePostFromRoadmapInput = z.infer<typeof removePostFromRoadmapSchema>
export type ReorderRoadmapPostsInput = z.infer<typeof reorderRoadmapPostsSchema>

// ============================================
// Actions
// ============================================

/**
 * List all roadmaps for a workspace.
 */
export const listRoadmapsAction = withAction(
  listRoadmapsSchema,
  async (_input, _ctx, serviceCtx) => {
    const result = await getRoadmapService().listRoadmaps(serviceCtx)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  }
)

/**
 * Get a single roadmap by ID.
 */
export const getRoadmapAction = withAction(getRoadmapSchema, async (input, _ctx, serviceCtx) => {
  const result = await getRoadmapService().getRoadmap(input.id as RoadmapId, serviceCtx)
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk(result.value)
})

/**
 * Create a new roadmap.
 */
export const createRoadmapAction = withAction(
  createRoadmapSchema,
  async (input, _ctx, serviceCtx) => {
    const result = await getRoadmapService().createRoadmap(
      {
        name: input.name,
        slug: input.slug,
        description: input.description,
        isPublic: input.isPublic,
      },
      serviceCtx
    )
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  },
  { roles: ['owner', 'admin', 'member'] }
)

/**
 * Update an existing roadmap.
 */
export const updateRoadmapAction = withAction(
  updateRoadmapSchema,
  async (input, _ctx, serviceCtx) => {
    const result = await getRoadmapService().updateRoadmap(
      input.id as RoadmapId,
      {
        name: input.name,
        description: input.description === null ? undefined : input.description,
        isPublic: input.isPublic,
      },
      serviceCtx
    )
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  },
  { roles: ['owner', 'admin', 'member'] }
)

/**
 * Delete a roadmap.
 */
export const deleteRoadmapAction = withAction(
  deleteRoadmapSchema,
  async (input, _ctx, serviceCtx) => {
    const result = await getRoadmapService().deleteRoadmap(input.id as RoadmapId, serviceCtx)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ id: input.id as string })
  },
  { roles: ['owner', 'admin', 'member'] }
)

/**
 * Reorder roadmaps in the sidebar.
 */
export const reorderRoadmapsAction = withAction(
  reorderRoadmapsSchema,
  async (input, _ctx, serviceCtx) => {
    // Validate all roadmap IDs
    const validatedRoadmapIds = input.roadmapIds.map((id) => {
      if (!isValidTypeId(id, 'roadmap')) {
        throw new Error(`Invalid roadmap ID format: ${id}`)
      }
      return id as RoadmapId
    })

    const result = await getRoadmapService().reorderRoadmaps(validatedRoadmapIds, serviceCtx)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ success: true })
  },
  { roles: ['owner', 'admin', 'member'] }
)

/**
 * Get posts for a roadmap, optionally filtered by status.
 */
export const getRoadmapPostsAction = withAction(
  getRoadmapPostsSchema,
  async (input, _ctx, serviceCtx) => {
    const result = await getRoadmapService().getRoadmapPosts(
      input.roadmapId as RoadmapId,
      {
        statusId: input.statusId as StatusId | undefined,
        limit: input.limit,
        offset: input.offset,
      },
      serviceCtx
    )
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  }
)

/**
 * Add a post to a roadmap.
 */
export const addPostToRoadmapAction = withAction(
  addPostToRoadmapSchema,
  async (input, _ctx, serviceCtx) => {
    const result = await getRoadmapService().addPostToRoadmap(
      {
        postId: input.postId as PostId,
        roadmapId: input.roadmapId as RoadmapId,
      },
      serviceCtx
    )
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ added: true })
  },
  { roles: ['owner', 'admin', 'member'] }
)

/**
 * Remove a post from a roadmap.
 */
export const removePostFromRoadmapAction = withAction(
  removePostFromRoadmapSchema,
  async (input, _ctx, serviceCtx) => {
    const result = await getRoadmapService().removePostFromRoadmap(
      input.postId as PostId,
      input.roadmapId as RoadmapId,
      serviceCtx
    )
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ removed: true })
  },
  { roles: ['owner', 'admin', 'member'] }
)

/**
 * Reorder posts within a roadmap column.
 */
export const reorderRoadmapPostsAction = withAction(
  reorderRoadmapPostsSchema,
  async (input, _ctx, serviceCtx) => {
    // Validate all post IDs
    const validatedPostIds = input.postIds.map((id) => {
      if (!isValidTypeId(id, 'post')) {
        throw new Error(`Invalid post ID format: ${id}`)
      }
      return id as PostId
    })

    const result = await getRoadmapService().reorderPostsInColumn(
      {
        roadmapId: input.roadmapId as RoadmapId,
        postIds: validatedPostIds,
      },
      serviceCtx
    )
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ success: true })
  },
  { roles: ['owner', 'admin', 'member'] }
)
