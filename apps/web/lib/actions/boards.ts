'use server'

import { z } from 'zod'
import { withAction, mapDomainError } from './with-action'
import { actionOk, actionErr } from './types'
import { getBoardService } from '@/lib/services'
import { boardIdSchema, type BoardId } from '@quackback/ids'

// ============================================
// Schemas
// ============================================

const listBoardsSchema = z.object({})

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

export type ListBoardsInput = z.infer<typeof listBoardsSchema>
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
export const listBoardsAction = withAction(listBoardsSchema, async (_input, _ctx, serviceCtx) => {
  const result = await getBoardService().listBoards(serviceCtx)
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk(result.value)
})

/**
 * Get a single board by ID.
 */
export const getBoardAction = withAction(getBoardSchema, async (input, _ctx, serviceCtx) => {
  const result = await getBoardService().getBoardById(input.id as BoardId, serviceCtx)
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk(result.value)
})

/**
 * Create a new board.
 */
export const createBoardAction = withAction(
  createBoardSchema,
  async (input, _ctx, serviceCtx) => {
    const result = await getBoardService().createBoard(
      {
        name: input.name,
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
 * Update an existing board.
 */
export const updateBoardAction = withAction(
  updateBoardSchema,
  async (input, _ctx, serviceCtx) => {
    const result = await getBoardService().updateBoard(
      input.id as BoardId,
      {
        name: input.name,
        description: input.description,
        isPublic: input.isPublic,
        settings: input.settings,
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
 * Delete a board.
 */
export const deleteBoardAction = withAction(
  deleteBoardSchema,
  async (input, _ctx, serviceCtx) => {
    const result = await getBoardService().deleteBoard(input.id as BoardId, serviceCtx)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ id: input.id as string })
  },
  { roles: ['owner', 'admin', 'member'] }
)
