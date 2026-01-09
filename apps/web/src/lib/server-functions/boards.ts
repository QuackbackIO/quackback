/**
 * Server functions for board operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { boardIdSchema, statusIdSchema } from '@quackback/ids'
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
  id: boardIdSchema,
})

const boardSettingsSchema = z
  .object({
    roadmapStatusIds: z.array(statusIdSchema).optional(),
  })
  .strict()

const updateBoardSchema = z.object({
  id: boardIdSchema,
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  isPublic: z.boolean().optional(),
  settings: boardSettingsSchema.optional(),
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
// Read Operations
// ============================================

/**
 * List all boards for the authenticated user's workspace
 */
export const fetchBoards = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:boards] fetchBoards`)
  try {
    await requireAuth({ roles: ['admin', 'member'] })

    const boards = await listBoards()
    console.log(`[fn:boards] fetchBoards: count=${boards.length}`)
    // Serialize settings field and Date fields
    return boards.map((b) => ({
      ...b,
      settings: (b.settings ?? {}) as BoardSettings,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    }))
  } catch (error) {
    console.error(`[fn:boards] ❌ fetchBoards failed:`, error)
    throw error
  }
})

/**
 * Get a single board by ID
 */
export const fetchBoard = createServerFn({ method: 'GET' })
  .inputValidator(getBoardSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:boards] fetchBoard: id=${data.id}`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const board = await getBoardById(data.id)
      console.log(`[fn:boards] fetchBoard: found=${!!board}`)
      return {
        ...board,
        settings: (board.settings ?? {}) as BoardSettings,
        createdAt: board.createdAt.toISOString(),
        updatedAt: board.updatedAt.toISOString(),
      }
    } catch (error) {
      console.error(`[fn:boards] ❌ fetchBoard failed:`, error)
      throw error
    }
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
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const board = await createBoard({
        name: data.name,
        description: data.description,
        isPublic: data.isPublic,
      })
      console.log(`[fn:boards] createBoardFn: id=${board.id}`)
      // Serialize Date fields
      return {
        ...board,
        createdAt: board.createdAt.toISOString(),
        updatedAt: board.updatedAt.toISOString(),
      }
    } catch (error) {
      console.error(`[fn:boards] ❌ createBoardFn failed:`, error)
      throw error
    }
  })

/**
 * Update an existing board
 */
export const updateBoardFn = createServerFn({ method: 'POST' })
  .inputValidator(updateBoardSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:boards] updateBoardFn: id=${data.id}`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const board = await updateBoard(data.id, {
        name: data.name,
        description: data.description,
        isPublic: data.isPublic,
        settings: data.settings,
      })
      console.log(`[fn:boards] updateBoardFn: updated id=${board.id}`)
      // Serialize Date fields
      return {
        ...board,
        createdAt: board.createdAt.toISOString(),
        updatedAt: board.updatedAt.toISOString(),
      }
    } catch (error) {
      console.error(`[fn:boards] ❌ updateBoardFn failed:`, error)
      throw error
    }
  })

/**
 * Delete a board
 */
export const deleteBoardFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteBoardSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:boards] deleteBoardFn: id=${data.id}`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      await deleteBoard(data.id)
      console.log(`[fn:boards] deleteBoardFn: deleted id=${data.id}`)
      return { id: data.id }
    } catch (error) {
      console.error(`[fn:boards] ❌ deleteBoardFn failed:`, error)
      throw error
    }
  })
