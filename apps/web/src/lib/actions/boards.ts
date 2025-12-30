import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSession } from '@/lib/auth/server'
import { db, member, eq } from '@/lib/db'
import { listBoards, getBoardById, createBoard, updateBoard, deleteBoard } from '@/lib/boards'
import { boardIdSchema, type BoardId, type UserId } from '@quackback/ids'
import { actionOk, actionErr, mapDomainError, type ActionResult } from './types'

// ============================================
// Schemas
// ============================================

const createBoardSchema = z.object({
  name: z
    .string()
    .min(1, 'Board name is required')
    .max(100, 'Board name must be 100 characters or less'),
  description: z.string().max(500, 'Description must be 500 characters or less').optional(),
  isPublic: z.boolean().default(true),
})

const getBoardSchema = z.object({
  id: boardIdSchema,
})

const updateBoardSchema = z.object({
  id: boardIdSchema,
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  isPublic: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
})

const deleteBoardSchema = z.object({
  id: boardIdSchema,
})

// ============================================
// Type Exports
// ============================================

export type CreateBoardInput = z.infer<typeof createBoardSchema>
export type GetBoardInput = z.infer<typeof getBoardSchema>
export type UpdateBoardInput = z.infer<typeof updateBoardSchema>
export type DeleteBoardInput = z.infer<typeof deleteBoardSchema>

// ============================================
// Server Functions
// ============================================

/**
 * List all boards for a workspace.
 */
export const listBoardsAction = createServerFn({ method: 'GET' }).handler(async () => {
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

  const result = await listBoards()
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk(result.value)
})

/**
 * Get a single board by ID.
 */
export const getBoardAction = createServerFn({ method: 'POST' })
  .inputValidator(getBoardSchema)
  .handler(async ({ data }) => {
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

    const result = await getBoardById(data.id as BoardId)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  })

/**
 * Create a new board.
 */
export const createBoardAction = createServerFn({ method: 'POST' })
  .inputValidator(createBoardSchema)
  .handler(async ({ data }) => {
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

    const result = await createBoard({
      name: data.name,
      description: data.description,
      isPublic: data.isPublic,
    })
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  })

/**
 * Update an existing board.
 */
export const updateBoardAction = createServerFn({ method: 'POST' })
  .inputValidator(updateBoardSchema)
  .handler(async ({ data }) => {
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

    const result = await updateBoard(data.id as BoardId, {
      name: data.name,
      description: data.description,
      isPublic: data.isPublic,
      settings: data.settings,
    })
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  })

/**
 * Delete a board.
 */
export const deleteBoardAction = createServerFn({ method: 'POST' })
  .inputValidator(deleteBoardSchema)
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

    const result = await deleteBoard(data.id as BoardId)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ id: data.id })
  })
