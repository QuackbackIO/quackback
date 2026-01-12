/**
 * Server functions for board operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { BoardId } from '@quackback/ids'
import type { BoardSettings } from '@quackback/db/types'
import { requireAuth } from './auth-helpers'
import {
  listBoards,
  getBoardById,
  createBoard,
  updateBoard,
  deleteBoard,
} from '@/lib/boards/board.service'

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
  id: z.string(),
})

const boardSettingsSchema = z
  .object({
    roadmapStatusIds: z.array(z.string()).optional(),
  })
  .strict()

const updateBoardSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  isPublic: z.boolean().optional(),
  settings: boardSettingsSchema.optional(),
})

const deleteBoardSchema = z.object({
  id: z.string(),
})

const createBoardsBatchSchema = z.object({
  boards: z
    .array(
      z.object({
        name: z
          .string()
          .min(1, 'Board name is required')
          .max(100, 'Board name must be 100 characters or less'),
        description: z.string().max(500).optional(),
      })
    )
    .max(10, 'Maximum 10 boards can be created at once'),
})

// ============================================
// Type Exports
// ============================================

export type CreateBoardInput = z.infer<typeof createBoardSchema>
export type GetBoardInput = z.infer<typeof getBoardSchema>
export type UpdateBoardInput = z.infer<typeof updateBoardSchema>
export type DeleteBoardInput = z.infer<typeof deleteBoardSchema>
export type CreateBoardsBatchInput = z.infer<typeof createBoardsBatchSchema>

// ============================================
// Read Operations
// ============================================

function serializeBoard(b: Awaited<ReturnType<typeof listBoards>>[number]) {
  return {
    ...b,
    settings: (b.settings ?? {}) as BoardSettings,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  }
}

/**
 * List all boards for the authenticated user's workspace
 */
export const fetchBoards = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:boards] fetchBoards`)
  await requireAuth({ roles: ['admin', 'member'] })

  const boards = await listBoards()
  console.log(`[fn:boards] fetchBoards: count=${boards.length}`)
  return boards.map(serializeBoard)
})

/**
 * Get a single board by ID
 */
export const fetchBoard = createServerFn({ method: 'GET' })
  .inputValidator(getBoardSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:boards] fetchBoard: id=${data.id}`)
    await requireAuth({ roles: ['admin', 'member'] })

    const board = await getBoardById(data.id as BoardId)
    console.log(`[fn:boards] fetchBoard: found=${!!board}`)
    return serializeBoard(board)
  })

// ============================================
// Write Operations
// ============================================

/**
 * Create a new board
 */
export const createBoardFn = createServerFn({ method: 'POST' })
  .inputValidator(createBoardSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:boards] createBoardFn: name=${data.name}`)
    await requireAuth({ roles: ['admin', 'member'] })

    const board = await createBoard({
      name: data.name,
      description: data.description,
      isPublic: data.isPublic,
    })
    console.log(`[fn:boards] createBoardFn: id=${board.id}`)
    return serializeBoard(board)
  })

/**
 * Update an existing board
 */
export const updateBoardFn = createServerFn({ method: 'POST' })
  .inputValidator(updateBoardSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:boards] updateBoardFn: id=${data.id}`)
    await requireAuth({ roles: ['admin', 'member'] })

    const board = await updateBoard(data.id as BoardId, {
      name: data.name,
      description: data.description,
      isPublic: data.isPublic,
      settings: data.settings as BoardSettings | undefined,
    })
    console.log(`[fn:boards] updateBoardFn: updated id=${board.id}`)
    return serializeBoard(board)
  })

/**
 * Delete a board
 */
export const deleteBoardFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteBoardSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:boards] deleteBoardFn: id=${data.id}`)
    await requireAuth({ roles: ['admin', 'member'] })

    await deleteBoard(data.id as BoardId)
    console.log(`[fn:boards] deleteBoardFn: deleted id=${data.id}`)
    return { id: data.id }
  })

/**
 * Create multiple boards at once (for onboarding).
 * Allows empty array for skip functionality.
 */
export const createBoardsBatchFn = createServerFn({ method: 'POST' })
  .inputValidator(createBoardsBatchSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:boards] createBoardsBatchFn: count=${data.boards.length}`)
    await requireAuth({ roles: ['admin', 'member'] })

    if (data.boards.length === 0) {
      console.log(`[fn:boards] createBoardsBatchFn: skipped (no boards selected)`)
      return []
    }

    // Create boards sequentially to handle slug uniqueness
    const createdBoards = []
    for (const boardInput of data.boards) {
      const board = await createBoard({
        name: boardInput.name,
        description: boardInput.description,
        isPublic: true,
      })
      createdBoards.push(serializeBoard(board))
    }

    console.log(`[fn:boards] createBoardsBatchFn: created ${createdBoards.length} boards`)
    return createdBoards
  })
