/**
 * Server functions for roadmap operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import {
  type RoadmapId,
  type PostId,
  type StatusId,
  type BoardId,
  type TagId,
  type SegmentId,
} from '@featurepool/ids'
import { requireAuth } from './auth-helpers'
import {
  addPostToRoadmap,
  createRoadmap,
  deleteRoadmap,
  getRoadmap,
  listRoadmaps,
  removePostFromRoadmap,
  reorderRoadmaps,
  updateRoadmap,
} from '@/lib/server/domains/roadmaps/roadmap.service'
import { getRoadmapPosts } from '@/lib/server/domains/roadmaps/roadmap.query'

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

const reorderRoadmapsSchema = z.object({
  roadmapIds: z.array(z.string()),
})

const getRoadmapPostsSchema = z.object({
  roadmapId: z.string(),
  statusId: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
  search: z.string().optional(),
  boardIds: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  segmentIds: z.array(z.string()).optional(),
  sort: z.enum(['votes', 'newest', 'oldest']).optional(),
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
  console.log(`[fn:roadmaps] fetchRoadmaps`)
  try {
    await requireAuth({ roles: ['admin', 'member'] })

    const roadmaps = await listRoadmaps()
    // Serialize branded types to plain strings for turbo-stream
    return roadmaps.map((roadmap) => ({
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
    console.error(`[fn:roadmaps] fetchRoadmaps failed:`, error)
    throw error
  }
})

/**
 * Get a single roadmap by ID
 */
export const fetchRoadmap = createServerFn({ method: 'GET' })
  .inputValidator(getRoadmapSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:roadmaps] fetchRoadmap: id=${data.id}`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const roadmap = await getRoadmap(data.id as RoadmapId)
      // Serialize branded types to plain strings for turbo-stream
      return {
        id: String(roadmap.id),
        name: roadmap.name,
        slug: roadmap.slug,
        description: roadmap.description,
        isPublic: roadmap.isPublic,
        position: roadmap.position,
        createdAt: roadmap.createdAt.toISOString(),
        updatedAt: roadmap.updatedAt.toISOString(),
      }
    } catch (error) {
      console.error(`[fn:roadmaps] fetchRoadmap failed:`, error)
      throw error
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
    console.log(`[fn:roadmaps] createRoadmapFn: name=${data.name}, slug=${data.slug}`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const roadmap = await createRoadmap({
        name: data.name,
        slug: data.slug,
        description: data.description,
        isPublic: data.isPublic,
      })
      // Serialize branded types to plain strings for turbo-stream
      return {
        id: String(roadmap.id),
        name: roadmap.name,
        slug: roadmap.slug,
        description: roadmap.description,
        isPublic: roadmap.isPublic,
        position: roadmap.position,
        createdAt: roadmap.createdAt.toISOString(),
        updatedAt: roadmap.updatedAt.toISOString(),
      }
    } catch (error) {
      console.error(`[fn:roadmaps] createRoadmapFn failed:`, error)
      throw error
    }
  })

/**
 * Update an existing roadmap
 */
export const updateRoadmapFn = createServerFn({ method: 'POST' })
  .inputValidator(updateRoadmapSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:roadmaps] updateRoadmapFn: id=${data.id}`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const roadmap = await updateRoadmap(data.id as RoadmapId, {
        name: data.name,
        description: data.description,
        isPublic: data.isPublic,
      })
      // Serialize branded types to plain strings for turbo-stream
      return {
        id: String(roadmap.id),
        name: roadmap.name,
        slug: roadmap.slug,
        description: roadmap.description,
        isPublic: roadmap.isPublic,
        position: roadmap.position,
        createdAt: roadmap.createdAt.toISOString(),
        updatedAt: roadmap.updatedAt.toISOString(),
      }
    } catch (error) {
      console.error(`[fn:roadmaps] updateRoadmapFn failed:`, error)
      throw error
    }
  })

/**
 * Delete a roadmap
 */
export const deleteRoadmapFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteRoadmapSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:roadmaps] deleteRoadmapFn: id=${data.id}`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      await deleteRoadmap(data.id as RoadmapId)
      return { id: String(data.id) }
    } catch (error) {
      console.error(`[fn:roadmaps] deleteRoadmapFn failed:`, error)
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
      const auth = await requireAuth({ roles: ['admin', 'member'] })

      await addPostToRoadmap(
        {
          roadmapId: data.roadmapId as RoadmapId,
          postId: data.postId as PostId,
        },
        auth.principal.id
      )
      return { success: true }
    } catch (error) {
      console.error(`[fn:roadmaps] addPostToRoadmapFn failed:`, error)
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
      const auth = await requireAuth({ roles: ['admin', 'member'] })

      await removePostFromRoadmap(
        data.postId as PostId,
        data.roadmapId as RoadmapId,
        auth.principal.id
      )
      return { success: true }
    } catch (error) {
      console.error(`[fn:roadmaps] removePostFromRoadmapFn failed:`, error)
      throw error
    }
  })

/**
 * Reorder roadmaps
 */
export const reorderRoadmapsFn = createServerFn({ method: 'POST' })
  .inputValidator(reorderRoadmapsSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:roadmaps] reorderRoadmapsFn: count=${data.roadmapIds.length}`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      await reorderRoadmaps(data.roadmapIds as RoadmapId[])
      return { success: true }
    } catch (error) {
      console.error(`[fn:roadmaps] reorderRoadmapsFn failed:`, error)
      throw error
    }
  })

/**
 * Get posts for a roadmap
 */
export const getRoadmapPostsFn = createServerFn({ method: 'GET' })
  .inputValidator(getRoadmapPostsSchema)
  .handler(async ({ data }) => {
    console.log(
      `[fn:roadmaps] getRoadmapPostsFn: roadmapId=${data.roadmapId}, limit=${data.limit}, offset=${data.offset}`
    )
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const result = await getRoadmapPosts(data.roadmapId as RoadmapId, {
        statusId: data.statusId as StatusId | undefined,
        limit: data.limit,
        offset: data.offset,
        search: data.search,
        boardIds: data.boardIds as BoardId[] | undefined,
        tagIds: data.tagIds as TagId[] | undefined,
        segmentIds: data.segmentIds as SegmentId[] | undefined,
        sort: data.sort,
      })

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
      console.error(`[fn:roadmaps] getRoadmapPostsFn failed:`, error)
      throw error
    }
  })
