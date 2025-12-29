'use server'

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
export async function listRoadmapsAction(): Promise<ActionResult<Roadmap[]>> {
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

/**
 * Get a single roadmap by ID.
 */
export async function getRoadmapAction(rawInput: unknown): Promise<ActionResult<Roadmap>> {
  const parsed = getRoadmapSchema.safeParse(rawInput)
  if (!parsed.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }

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

  const result = await getRoadmap(parsed.data.id as RoadmapId)
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk(result.value)
}

/**
 * Create a new roadmap.
 */
export async function createRoadmapAction(rawInput: unknown): Promise<ActionResult<Roadmap>> {
  const parsed = createRoadmapSchema.safeParse(rawInput)
  if (!parsed.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }

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
    name: parsed.data.name,
    slug: parsed.data.slug,
    description: parsed.data.description,
    isPublic: parsed.data.isPublic,
  })
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk(result.value)
}

/**
 * Update an existing roadmap.
 */
export async function updateRoadmapAction(rawInput: unknown): Promise<ActionResult<Roadmap>> {
  const parsed = updateRoadmapSchema.safeParse(rawInput)
  if (!parsed.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }

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

  const result = await updateRoadmap(parsed.data.id as RoadmapId, {
    name: parsed.data.name,
    description: parsed.data.description === null ? undefined : parsed.data.description,
    isPublic: parsed.data.isPublic,
  })
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk(result.value)
}

/**
 * Delete a roadmap.
 */
export async function deleteRoadmapAction(
  rawInput: unknown
): Promise<ActionResult<{ id: string }>> {
  const parsed = deleteRoadmapSchema.safeParse(rawInput)
  if (!parsed.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }

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

  const result = await deleteRoadmap(parsed.data.id as RoadmapId)
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk({ id: parsed.data.id as string })
}

/**
 * Reorder roadmaps in the sidebar.
 */
export async function reorderRoadmapsAction(
  rawInput: unknown
): Promise<ActionResult<{ success: boolean }>> {
  const parsed = reorderRoadmapsSchema.safeParse(rawInput)
  if (!parsed.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }

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
  const validatedRoadmapIds = parsed.data.roadmapIds.map((id) => {
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
}

/**
 * Get posts for a roadmap, optionally filtered by status.
 */
export async function getRoadmapPostsAction(
  rawInput: unknown
): Promise<ActionResult<RoadmapPostsListResult>> {
  const parsed = getRoadmapPostsSchema.safeParse(rawInput)
  if (!parsed.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }

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

  const result = await getRoadmapPosts(parsed.data.roadmapId as RoadmapId, {
    statusId: parsed.data.statusId as StatusId | undefined,
    limit: parsed.data.limit,
    offset: parsed.data.offset,
  })
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk(result.value)
}

/**
 * Add a post to a roadmap.
 */
export async function addPostToRoadmapAction(
  rawInput: unknown
): Promise<ActionResult<{ added: boolean }>> {
  const parsed = addPostToRoadmapSchema.safeParse(rawInput)
  if (!parsed.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }

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
    postId: parsed.data.postId as PostId,
    roadmapId: parsed.data.roadmapId as RoadmapId,
  })
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk({ added: true })
}

/**
 * Remove a post from a roadmap.
 */
export async function removePostFromRoadmapAction(
  rawInput: unknown
): Promise<ActionResult<{ removed: boolean }>> {
  const parsed = removePostFromRoadmapSchema.safeParse(rawInput)
  if (!parsed.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }

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

  const result = await removePostFromRoadmap(
    parsed.data.postId as PostId,
    parsed.data.roadmapId as RoadmapId
  )
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk({ removed: true })
}

/**
 * Reorder posts within a roadmap column.
 */
export async function reorderRoadmapPostsAction(
  rawInput: unknown
): Promise<ActionResult<{ success: boolean }>> {
  const parsed = reorderRoadmapPostsSchema.safeParse(rawInput)
  if (!parsed.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }

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
  const validatedPostIds = parsed.data.postIds.map((id) => {
    if (!isValidTypeId(id, 'post')) {
      throw new Error(`Invalid post ID format: ${id}`)
    }
    return id as PostId
  })

  const result = await reorderPostsInColumn({
    roadmapId: parsed.data.roadmapId as RoadmapId,
    postIds: validatedPostIds,
  })
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk({ success: true })
}
