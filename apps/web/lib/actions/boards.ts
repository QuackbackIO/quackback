'use server'

import { z } from 'zod'
import { getSession } from '@/lib/auth/server'
import { db, member, eq } from '@/lib/db'
import { listBoards, getBoardById, createBoard, updateBoard, deleteBoard } from '@/lib/boards'
import { boardIdSchema, type BoardId, type UserId } from '@quackback/ids'
import { actionOk, actionErr, mapDomainError, type ActionResult } from './types'
import type { Board } from '@quackback/db'

// ============================================
// Schemas
// ============================================

const _listBoardsSchema = z.object({})

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

export type ListBoardsInput = z.infer<typeof _listBoardsSchema>
export type CreateBoardInput = z.infer<typeof createBoardSchema>
export type GetBoardInput = z.infer<typeof getBoardSchema>
export type UpdateBoardInput = z.infer<typeof updateBoardSchema>
export type DeleteBoardInput = z.infer<typeof deleteBoardSchema>

// ============================================
// Actions
// ============================================

/**
 * List all boards for a workspace.
 */
export async function listBoardsAction(): Promise<ActionResult<Board[]>> {
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
}

/**
 * Get a single board by ID.
 */
export async function getBoardAction(rawInput: unknown): Promise<ActionResult<Board>> {
  const parsed = getBoardSchema.safeParse(rawInput)
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

  const result = await getBoardById(parsed.data.id as BoardId)
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk(result.value)
}

/**
 * Create a new board.
 */
export async function createBoardAction(rawInput: unknown): Promise<ActionResult<Board>> {
  const parsed = createBoardSchema.safeParse(rawInput)
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

  const result = await createBoard({
    name: parsed.data.name,
    description: parsed.data.description,
    isPublic: parsed.data.isPublic,
  })
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk(result.value)
}

/**
 * Update an existing board.
 */
export async function updateBoardAction(rawInput: unknown): Promise<ActionResult<Board>> {
  const parsed = updateBoardSchema.safeParse(rawInput)
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

  const result = await updateBoard(parsed.data.id as BoardId, {
    name: parsed.data.name,
    description: parsed.data.description,
    isPublic: parsed.data.isPublic,
    settings: parsed.data.settings,
  })
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk(result.value)
}

/**
 * Delete a board.
 */
export async function deleteBoardAction(rawInput: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = deleteBoardSchema.safeParse(rawInput)
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

  const result = await deleteBoard(parsed.data.id as BoardId)
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk({ id: parsed.data.id })
}
