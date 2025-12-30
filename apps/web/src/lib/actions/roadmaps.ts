import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSession } from '@/lib/auth/server'
import { db, member, eq } from '@/lib/db'
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
  reorderPostsInColumn,
  type RoadmapPostsListResult,
} from '@/lib/roadmaps'
import {
  roadmapIdSchema,
  postIdSchema,
  statusIdSchema,
  isValidTypeId,
  type RoadmapId,
  type PostId,
  type StatusId,
  type UserId,
} from '@quackback/ids'
import { actionOk, actionErr, mapDomainError, type ActionResult } from './types'
import type { Roadmap } from '@quackback/db'

// ============================================
// Schemas
// ============================================

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
export const listRoadmapsAction = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ActionResult<Roadmap[]>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    const result = await listRoadmaps()
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  }
)

/**
 * Get a single roadmap by ID.
 */
export const getRoadmapAction = createServerFn({ method: 'POST' })
  .inputValidator(getRoadmapSchema)
  .handler(async ({ data }): Promise<ActionResult<Roadmap>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    const result = await getRoadmap(data.id as RoadmapId)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  })

/**
 * Create a new roadmap.
 */
export const createRoadmapAction = createServerFn({ method: 'POST' })
  .inputValidator(createRoadmapSchema)
  .handler(async ({ data }): Promise<ActionResult<Roadmap>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin', 'member'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const result = await createRoadmap({
      name: data.name,
      slug: data.slug,
      description: data.description,
      isPublic: data.isPublic,
    })
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  })

/**
 * Update an existing roadmap.
 */
export const updateRoadmapAction = createServerFn({ method: 'POST' })
  .inputValidator(updateRoadmapSchema)
  .handler(async ({ data }): Promise<ActionResult<Roadmap>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin', 'member'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const result = await updateRoadmap(data.id as RoadmapId, {
      name: data.name,
      description: data.description === null ? undefined : data.description,
      isPublic: data.isPublic,
    })
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  })

/**
 * Delete a roadmap.
 */
export const deleteRoadmapAction = createServerFn({ method: 'POST' })
  .inputValidator(deleteRoadmapSchema)
  .handler(async ({ data }): Promise<ActionResult<{ id: string }>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin', 'member'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const result = await deleteRoadmap(data.id as RoadmapId)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ id: data.id as string })
  })

/**
 * Reorder roadmaps in the sidebar.
 */
export const reorderRoadmapsAction = createServerFn({ method: 'POST' })
  .inputValidator(reorderRoadmapsSchema)
  .handler(async ({ data }): Promise<ActionResult<{ success: boolean }>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin', 'member'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    // Validate all roadmap IDs
    const validatedRoadmapIds = data.roadmapIds.map((id) => {
      if (!isValidTypeId(id, 'roadmap')) {
        throw new Error(`Invalid roadmap ID format: ${id}`)
      }
      return id as RoadmapId
    })

    const result = await reorderRoadmaps(validatedRoadmapIds)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ success: true })
  })

/**
 * Get posts for a roadmap, optionally filtered by status.
 */
export const getRoadmapPostsAction = createServerFn({ method: 'POST' })
  .inputValidator(getRoadmapPostsSchema)
  .handler(async ({ data }): Promise<ActionResult<RoadmapPostsListResult>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    const result = await getRoadmapPosts(data.roadmapId as RoadmapId, {
      statusId: data.statusId as StatusId | undefined,
      limit: data.limit,
      offset: data.offset,
    })
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  })

/**
 * Add a post to a roadmap.
 */
export const addPostToRoadmapAction = createServerFn({ method: 'POST' })
  .inputValidator(addPostToRoadmapSchema)
  .handler(async ({ data }): Promise<ActionResult<{ added: boolean }>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin', 'member'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const result = await addPostToRoadmap({
      postId: data.postId as PostId,
      roadmapId: data.roadmapId as RoadmapId,
    })
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ added: true })
  })

/**
 * Remove a post from a roadmap.
 */
export const removePostFromRoadmapAction = createServerFn({ method: 'POST' })
  .inputValidator(removePostFromRoadmapSchema)
  .handler(async ({ data }): Promise<ActionResult<{ removed: boolean }>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin', 'member'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const result = await removePostFromRoadmap(data.postId as PostId, data.roadmapId as RoadmapId)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ removed: true })
  })

/**
 * Reorder posts within a roadmap column.
 */
export const reorderRoadmapPostsAction = createServerFn({ method: 'POST' })
  .inputValidator(reorderRoadmapPostsSchema)
  .handler(async ({ data }): Promise<ActionResult<{ success: boolean }>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin', 'member'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    // Validate all post IDs
    const validatedPostIds = data.postIds.map((id) => {
      if (!isValidTypeId(id, 'post')) {
        throw new Error(`Invalid post ID format: ${id}`)
      }
      return id as PostId
    })

    const result = await reorderPostsInColumn({
      roadmapId: data.roadmapId as RoadmapId,
      postIds: validatedPostIds,
    })
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ success: true })
  })
