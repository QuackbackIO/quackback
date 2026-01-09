/**
 * Server functions for roadmap operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { roadmapIdSchema, postIdSchema, statusIdSchema } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import {
  addPostToRoadmap,
  createRoadmap,
  deleteRoadmap,
  getRoadmap,
  getRoadmapPosts,
  listRoadmaps,
  removePostFromRoadmap,
  reorderRoadmaps,
  updateRoadmap,
} from '@/lib/roadmaps/roadmap.service'

// ============================================
// Schemas
// ============================================

const createRoadmapSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100),
  description: z.string().optional(),
  isPublic: z.boolean().optional(),
})

const getRoadmapSchema = z.object({
  id: roadmapIdSchema,
})

const updateRoadmapSchema = z.object({
  id: roadmapIdSchema,
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  isPublic: z.boolean().optional(),
})

const deleteRoadmapSchema = z.object({
  id: roadmapIdSchema,
})

const addPostToRoadmapSchema = z.object({
  roadmapId: roadmapIdSchema,
  postId: postIdSchema,
})

const removePostFromRoadmapSchema = z.object({
  roadmapId: roadmapIdSchema,
  postId: postIdSchema,
})

const reorderRoadmapsSchema = z.object({
  roadmapIds: z.array(roadmapIdSchema),
})

const getRoadmapPostsSchema = z.object({
  roadmapId: roadmapIdSchema,
  statusId: statusIdSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
})

// ============================================
// Type Exports
// ============================================

export type CreateRoadmapInput = z.infer<typeof createRoadmapSchema>
export type GetRoadmapInput = z.infer<typeof getRoadmapSchema>
export type UpdateRoadmapInput = z.infer<typeof updateRoadmapSchema>
export type DeleteRoadmapInput = z.infer<typeof deleteRoadmapSchema>
export type AddPostToRoadmapInput = z.infer<typeof addPostToRoadmapSchema>
export type RemovePostFromRoadmapInput = z.infer<typeof removePostFromRoadmapSchema>
export type ReorderRoadmapsInput = z.infer<typeof reorderRoadmapsSchema>
export type GetRoadmapPostsInput = z.infer<typeof getRoadmapPostsSchema>

// ============================================
// Read Operations
// ============================================

/**
 * List all roadmaps for the workspace
 */
export const fetchRoadmaps = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['admin', 'member'] })

  const roadmaps = await listRoadmaps()
  return roadmaps.map((roadmap) => ({
    ...roadmap,
    createdAt: roadmap.createdAt.toISOString(),
    updatedAt: roadmap.updatedAt.toISOString(),
  }))
})

/**
 * Get a single roadmap by ID
 */
export const fetchRoadmap = createServerFn({ method: 'GET' })
  .inputValidator(getRoadmapSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })

    const roadmap = await getRoadmap(data.id)
    return {
      ...roadmap,
      createdAt: roadmap.createdAt.toISOString(),
      updatedAt: roadmap.updatedAt.toISOString(),
    }
  })

// ============================================
// Write Operations
// ============================================

/**
 * Create a new roadmap
 */
export const createRoadmapFn = createServerFn({ method: 'POST' })
  .inputValidator(createRoadmapSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })

    const roadmap = await createRoadmap({
      name: data.name,
      slug: data.slug,
      description: data.description,
      isPublic: data.isPublic,
    })
    return {
      ...roadmap,
      createdAt: roadmap.createdAt.toISOString(),
      updatedAt: roadmap.updatedAt.toISOString(),
    }
  })

/**
 * Update an existing roadmap
 */
export const updateRoadmapFn = createServerFn({ method: 'POST' })
  .inputValidator(updateRoadmapSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })

    const roadmap = await updateRoadmap(data.id, {
      name: data.name,
      description: data.description,
      isPublic: data.isPublic,
    })
    return {
      ...roadmap,
      createdAt: roadmap.createdAt.toISOString(),
      updatedAt: roadmap.updatedAt.toISOString(),
    }
  })

/**
 * Delete a roadmap
 */
export const deleteRoadmapFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteRoadmapSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })

    await deleteRoadmap(data.id)
    return { id: data.id }
  })

/**
 * Add a post to a roadmap
 */
export const addPostToRoadmapFn = createServerFn({ method: 'POST' })
  .inputValidator(addPostToRoadmapSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })

    await addPostToRoadmap({
      roadmapId: data.roadmapId,
      postId: data.postId,
    })
    return { roadmapId: data.roadmapId, postId: data.postId }
  })

/**
 * Remove a post from a roadmap
 */
export const removePostFromRoadmapFn = createServerFn({ method: 'POST' })
  .inputValidator(removePostFromRoadmapSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })

    await removePostFromRoadmap(data.postId, data.roadmapId)
    return { roadmapId: data.roadmapId, postId: data.postId }
  })

/**
 * Reorder roadmaps
 */
export const reorderRoadmapsFn = createServerFn({ method: 'POST' })
  .inputValidator(reorderRoadmapsSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })

    await reorderRoadmaps(data.roadmapIds)
    return { success: true }
  })

/**
 * Get posts for a roadmap
 */
export const getRoadmapPostsFn = createServerFn({ method: 'GET' })
  .inputValidator(getRoadmapPostsSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })

    return getRoadmapPosts(data.roadmapId, {
      statusId: data.statusId,
      limit: data.limit,
      offset: data.offset,
    })
  })
