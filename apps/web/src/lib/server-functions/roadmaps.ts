/**
 * Server functions for roadmap operations
 *
 * NOTE: All service imports are done dynamically inside handlers
 * to prevent client bundling issues with TanStack Start.
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { type RoadmapId, type PostId } from '@quackback/ids'

const createRoadmapSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100),
  description: z.string().optional(),
  isPublic: z.boolean().optional(),
})

const getRoadmapSchema = z.object({
  id: z.string(),
})

const updateRoadmapSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  isPublic: z.boolean().optional(),
})

const deleteRoadmapSchema = z.object({
  id: z.string(),
})

const addPostToRoadmapSchema = z.object({
  roadmapId: z.string(),
  postId: z.string(),
})

const removePostFromRoadmapSchema = z.object({
  roadmapId: z.string(),
  postId: z.string(),
})

export type CreateRoadmapInput = z.infer<typeof createRoadmapSchema>
export type GetRoadmapInput = z.infer<typeof getRoadmapSchema>
export type UpdateRoadmapInput = z.infer<typeof updateRoadmapSchema>
export type DeleteRoadmapInput = z.infer<typeof deleteRoadmapSchema>
export type AddPostToRoadmapInput = z.infer<typeof addPostToRoadmapSchema>
export type RemovePostFromRoadmapInput = z.infer<typeof removePostFromRoadmapSchema>

// Read Operations
export const fetchRoadmaps = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:roadmaps] fetchRoadmaps`)
  try {
    const { requireAuth } = await import('./auth-helpers')
    const { listRoadmaps } = await import('@/lib/roadmaps/roadmap.service')

    await requireAuth({ roles: ['admin', 'member'] })

    const roadmaps = await listRoadmaps()
    console.log(`[fn:roadmaps] fetchRoadmaps: count=${roadmaps.length}`)
    // Serialize Date fields
    return roadmaps.map((roadmap) => ({
      ...roadmap,
      createdAt: roadmap.createdAt.toISOString(),
      updatedAt: roadmap.updatedAt.toISOString(),
    }))
  } catch (error) {
    console.error(`[fn:roadmaps] ❌ fetchRoadmaps failed:`, error)
    throw error
  }
})

export const fetchRoadmap = createServerFn({ method: 'GET' })
  .inputValidator(getRoadmapSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:roadmaps] fetchRoadmap: id=${data.id}`)
    try {
      const { requireAuth } = await import('./auth-helpers')
      const { getRoadmap } = await import('@/lib/roadmaps/roadmap.service')

      await requireAuth({ roles: ['admin', 'member'] })

      const roadmap = await getRoadmap(data.id as RoadmapId)
      console.log(`[fn:roadmaps] fetchRoadmap: found=${!!roadmap}`)
      // Serialize Date fields
      return {
        ...roadmap,
        createdAt: roadmap.createdAt.toISOString(),
        updatedAt: roadmap.updatedAt.toISOString(),
      }
    } catch (error) {
      console.error(`[fn:roadmaps] ❌ fetchRoadmap failed:`, error)
      throw error
    }
  })

// Write Operations
export const createRoadmapFn = createServerFn({ method: 'POST' })
  .inputValidator(createRoadmapSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:roadmaps] createRoadmapFn: name=${data.name}`)
    try {
      const { requireAuth } = await import('./auth-helpers')
      const { createRoadmap } = await import('@/lib/roadmaps/roadmap.service')

      await requireAuth({ roles: ['admin', 'member'] })

      const roadmap = await createRoadmap({
        name: data.name,
        slug: data.slug,
        description: data.description,
        isPublic: data.isPublic,
      })
      console.log(`[fn:roadmaps] createRoadmapFn: id=${roadmap.id}`)
      // Serialize Date fields
      return {
        ...roadmap,
        createdAt: roadmap.createdAt.toISOString(),
        updatedAt: roadmap.updatedAt.toISOString(),
      }
    } catch (error) {
      console.error(`[fn:roadmaps] ❌ createRoadmapFn failed:`, error)
      throw error
    }
  })

export const updateRoadmapFn = createServerFn({ method: 'POST' })
  .inputValidator(updateRoadmapSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:roadmaps] updateRoadmapFn: id=${data.id}`)
    try {
      const { requireAuth } = await import('./auth-helpers')
      const { updateRoadmap } = await import('@/lib/roadmaps/roadmap.service')

      await requireAuth({ roles: ['admin', 'member'] })

      const roadmap = await updateRoadmap(data.id as RoadmapId, {
        name: data.name,
        description: data.description,
        isPublic: data.isPublic,
      })
      console.log(`[fn:roadmaps] updateRoadmapFn: updated id=${roadmap.id}`)
      // Serialize Date fields
      return {
        ...roadmap,
        createdAt: roadmap.createdAt.toISOString(),
        updatedAt: roadmap.updatedAt.toISOString(),
      }
    } catch (error) {
      console.error(`[fn:roadmaps] ❌ updateRoadmapFn failed:`, error)
      throw error
    }
  })

export const deleteRoadmapFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteRoadmapSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:roadmaps] deleteRoadmapFn: id=${data.id}`)
    try {
      const { requireAuth } = await import('./auth-helpers')
      const { deleteRoadmap } = await import('@/lib/roadmaps/roadmap.service')

      await requireAuth({ roles: ['admin', 'member'] })

      await deleteRoadmap(data.id as RoadmapId)
      console.log(`[fn:roadmaps] deleteRoadmapFn: deleted`)
      return { id: data.id }
    } catch (error) {
      console.error(`[fn:roadmaps] ❌ deleteRoadmapFn failed:`, error)
      throw error
    }
  })

/**
 * Add a post to a roadmap
 */
export const addPostToRoadmapFn = createServerFn({ method: 'POST' })
  .inputValidator(addPostToRoadmapSchema)
  .handler(async ({ data }) => {
    console.log(
      `[fn:roadmaps] addPostToRoadmapFn: roadmapId=${data.roadmapId}, postId=${data.postId}`
    )
    try {
      const { requireAuth } = await import('./auth-helpers')
      const { addPostToRoadmap } = await import('@/lib/roadmaps/roadmap.service')

      await requireAuth({ roles: ['admin', 'member'] })

      await addPostToRoadmap({
        roadmapId: data.roadmapId as RoadmapId,
        postId: data.postId as PostId,
      })
      console.log(`[fn:roadmaps] addPostToRoadmapFn: added`)
      return { roadmapId: data.roadmapId, postId: data.postId }
    } catch (error) {
      console.error(`[fn:roadmaps] ❌ addPostToRoadmapFn failed:`, error)
      throw error
    }
  })

/**
 * Remove a post from a roadmap
 */
export const removePostFromRoadmapFn = createServerFn({ method: 'POST' })
  .inputValidator(removePostFromRoadmapSchema)
  .handler(async ({ data }) => {
    console.log(
      `[fn:roadmaps] removePostFromRoadmapFn: roadmapId=${data.roadmapId}, postId=${data.postId}`
    )
    try {
      const { requireAuth } = await import('./auth-helpers')
      const { removePostFromRoadmap } = await import('@/lib/roadmaps/roadmap.service')

      await requireAuth({ roles: ['admin', 'member'] })

      await removePostFromRoadmap(data.postId as PostId, data.roadmapId as RoadmapId)
      console.log(`[fn:roadmaps] removePostFromRoadmapFn: removed`)
      return { roadmapId: data.roadmapId, postId: data.postId }
    } catch (error) {
      console.error(`[fn:roadmaps] ❌ removePostFromRoadmapFn failed:`, error)
      throw error
    }
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
    console.log(`[fn:roadmaps] reorderRoadmapsFn: count=${data.roadmapIds.length}`)
    try {
      const { requireAuth } = await import('./auth-helpers')
      const { reorderRoadmaps } = await import('@/lib/roadmaps/roadmap.service')

      await requireAuth({ roles: ['admin', 'member'] })

      await reorderRoadmaps(data.roadmapIds as RoadmapId[])
      console.log(`[fn:roadmaps] reorderRoadmapsFn: reordered`)
      return { success: true }
    } catch (error) {
      console.error(`[fn:roadmaps] ❌ reorderRoadmapsFn failed:`, error)
      throw error
    }
  })

const getRoadmapPostsSchema = z.object({
  roadmapId: z.string(),
  statusId: z.string().optional(),
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
    console.log(`[fn:roadmaps] getRoadmapPostsFn: roadmapId=${data.roadmapId}`)
    try {
      const { requireAuth } = await import('./auth-helpers')
      const { getRoadmapPosts } = await import('@/lib/roadmaps/roadmap.service')

      await requireAuth({ roles: ['admin', 'member'] })

      const posts = await getRoadmapPosts(data.roadmapId as RoadmapId, {})
      console.log(`[fn:roadmaps] getRoadmapPostsFn: count=${posts.length}`)
      return posts
    } catch (error) {
      console.error(`[fn:roadmaps] ❌ getRoadmapPostsFn failed:`, error)
      throw error
    }
  })
