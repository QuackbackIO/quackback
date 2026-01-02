/**
 * Server functions for board operations
 *
 * NOTE: All service imports are done dynamically inside handlers
 * to prevent client bundling issues with TanStack Start.
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { type BoardId } from '@quackback/ids'
import type { BoardSettings } from '@quackback/db/types'

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

const updateBoardSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  isPublic: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
})

const deleteBoardSchema = z.object({
  id: z.string(),
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
  const { requireAuth } = await import('./auth-helpers')
  const { listBoards } = await import('@/lib/boards/board.service')

  await requireAuth({ roles: ['admin', 'member'] })

  const result = await listBoards()
  if (!result.success) {
    throw new Error(result.error.message)
  }
  // Serialize settings field and Date fields
  return result.value.map((b) => ({
    ...b,
    settings: (b.settings ?? {}) as BoardSettings,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  }))
})

/**
 * Get a single board by ID
 */
export const fetchBoard = createServerFn({ method: 'GET' })
  .inputValidator(getBoardSchema)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('./auth-helpers')
    const { getBoardById } = await import('@/lib/boards/board.service')

    await requireAuth({ roles: ['admin', 'member'] })

    const result = await getBoardById(data.id as BoardId)
    if (!result.success) {
      throw new Error(result.error.message)
    }
    return {
      ...result.value,
      settings: (result.value.settings ?? {}) as BoardSettings,
      createdAt: result.value.createdAt.toISOString(),
      updatedAt: result.value.updatedAt.toISOString(),
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
    const { requireAuth } = await import('./auth-helpers')
    const { createBoard } = await import('@/lib/boards/board.service')

    await requireAuth({ roles: ['admin', 'member'] })

    const result = await createBoard({
      name: data.name,
      description: data.description,
      isPublic: data.isPublic,
    })
    if (!result.success) {
      throw new Error(result.error.message)
    }
    // Serialize Date fields
    return {
      ...result.value,
      createdAt: result.value.createdAt.toISOString(),
      updatedAt: result.value.updatedAt.toISOString(),
    }
  })

/**
 * Update an existing board
 */
export const updateBoardFn = createServerFn({ method: 'POST' })
  .inputValidator(updateBoardSchema)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('./auth-helpers')
    const { updateBoard } = await import('@/lib/boards/board.service')

    await requireAuth({ roles: ['admin', 'member'] })

    const result = await updateBoard(data.id as BoardId, {
      name: data.name,
      description: data.description,
      isPublic: data.isPublic,
      settings: data.settings,
    })
    if (!result.success) {
      throw new Error(result.error.message)
    }
    // Serialize Date fields
    return {
      ...result.value,
      createdAt: result.value.createdAt.toISOString(),
      updatedAt: result.value.updatedAt.toISOString(),
    }
  })

/**
 * Delete a board
 */
export const deleteBoardFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteBoardSchema)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('./auth-helpers')
    const { deleteBoard } = await import('@/lib/boards/board.service')

    await requireAuth({ roles: ['admin', 'member'] })

    const result = await deleteBoard(data.id as BoardId)
    if (!result.success) {
      throw new Error(result.error.message)
    }
    return { id: data.id }
  })
