/**
 * Server functions for roadmap operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from './auth-helpers'
import {
  listRoadmaps,
  getRoadmap,
  createRoadmap,
  updateRoadmap,
  deleteRoadmap,
  reorderRoadmaps,
  getRoadmapPosts,
  addPostToRoadmap,
  removePostFromRoadmap,
} from '@/lib/roadmaps'
import {
  roadmapIdSchema,
  postIdSchema,
  statusIdSchema,
  type RoadmapId,
  type PostId,
} from '@quackback/ids'

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

export type CreateRoadmapInput = z.infer<typeof createRoadmapSchema>
export type GetRoadmapInput = z.infer<typeof getRoadmapSchema>
export type UpdateRoadmapInput = z.infer<typeof updateRoadmapSchema>
export type DeleteRoadmapInput = z.infer<typeof deleteRoadmapSchema>
export type AddPostToRoadmapInput = z.infer<typeof addPostToRoadmapSchema>
export type RemovePostFromRoadmapInput = z.infer<typeof removePostFromRoadmapSchema>

// Read Operations
export const fetchRoadmaps = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['owner', 'admin', 'member'] })

  const result = await listRoadmaps()
  if (!result.success) throw new Error(result.error.message)
  // Serialize Date fields
  return result.value.map((roadmap) => ({
    ...roadmap,
    createdAt: roadmap.createdAt.toISOString(),
    updatedAt: roadmap.updatedAt.toISOString(),
  }))
})

export const fetchRoadmap = createServerFn({ method: 'GET' })
  .inputValidator(getRoadmapSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['owner', 'admin', 'member'] })

    const result = await getRoadmap(data.id as RoadmapId)
    if (!result.success) throw new Error(result.error.message)
    // Serialize Date fields
    return {
      ...result.value,
      createdAt: result.value.createdAt.toISOString(),
      updatedAt: result.value.updatedAt.toISOString(),
    }
  })

// Write Operations
export const createRoadmapFn = createServerFn({ method: 'POST' })
  .inputValidator(createRoadmapSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['owner', 'admin', 'member'] })

    const result = await createRoadmap({
      name: data.name,
      slug: data.slug,
      description: data.description,
      isPublic: data.isPublic,
    })
    if (!result.success) throw new Error(result.error.message)
    // Serialize Date fields
    return {
      ...result.value,
      createdAt: result.value.createdAt.toISOString(),
      updatedAt: result.value.updatedAt.toISOString(),
    }
  })

export const updateRoadmapFn = createServerFn({ method: 'POST' })
  .inputValidator(updateRoadmapSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['owner', 'admin', 'member'] })

    const result = await updateRoadmap(data.id as RoadmapId, {
      name: data.name,
      description: data.description,
      isPublic: data.isPublic,
    })
    if (!result.success) throw new Error(result.error.message)
    // Serialize Date fields
    return {
      ...result.value,
      createdAt: result.value.createdAt.toISOString(),
      updatedAt: result.value.updatedAt.toISOString(),
    }
  })

export const deleteRoadmapFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteRoadmapSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['owner', 'admin', 'member'] })

    const result = await deleteRoadmap(data.id as RoadmapId)
    if (!result.success) throw new Error(result.error.message)
    return { id: data.id }
  })

/**
 * Add a post to a roadmap
 */
export const addPostToRoadmapFn = createServerFn({ method: 'POST' })
  .inputValidator(addPostToRoadmapSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['owner', 'admin', 'member'] })

    const result = await addPostToRoadmap({
      roadmapId: data.roadmapId as RoadmapId,
      postId: data.postId as PostId,
    })
    if (!result.success) throw new Error(result.error.message)
    return { roadmapId: data.roadmapId, postId: data.postId }
  })

/**
 * Remove a post from a roadmap
 */
export const removePostFromRoadmapFn = createServerFn({ method: 'POST' })
  .inputValidator(removePostFromRoadmapSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['owner', 'admin', 'member'] })

    const result = await removePostFromRoadmap(data.postId as PostId, data.roadmapId as RoadmapId)
    if (!result.success) throw new Error(result.error.message)
    return { roadmapId: data.roadmapId, postId: data.postId }
  })

const reorderRoadmapsSchema = z.object({
  roadmapIds: z.array(z.string()),
})

export type ReorderRoadmapsInput = z.infer<typeof reorderRoadmapsSchema>

/**
 * Reorder roadmaps
 */
export const reorderRoadmapsFn = createServerFn({ method: 'POST' })
  .inputValidator(reorderRoadmapsSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['owner', 'admin', 'member'] })

    const result = await reorderRoadmaps(data.roadmapIds as RoadmapId[])
    if (!result.success) throw new Error(result.error.message)
    return { success: true }
  })

const getRoadmapPostsSchema = z.object({
  roadmapId: roadmapIdSchema,
  statusId: statusIdSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
})

export type GetRoadmapPostsInput = z.infer<typeof getRoadmapPostsSchema>

/**
 * Get posts for a roadmap
 */
export const getRoadmapPostsFn = createServerFn({ method: 'GET' })
  .inputValidator(getRoadmapPostsSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['owner', 'admin', 'member'] })

    const result = await getRoadmapPosts(data.roadmapId as RoadmapId, {})
    if (!result.success) throw new Error(result.error.message)
    return result.value
  })
