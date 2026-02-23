/**
 * Input/Output types for BoardService operations
 */

import type { Board, BoardSettings } from '@/lib/server/db'

/**
 * Input for creating a new board
 */
export interface CreateBoardInput {
  name: string
  description?: string | null
  slug?: string // If not provided, will be auto-generated from name
  isPublic?: boolean
  settings?: BoardSettings
}

/**
 * Input for updating an existing board
 */
export interface UpdateBoardInput {
  name?: string
  description?: string | null
  slug?: string
  isPublic?: boolean
  settings?: BoardSettings
}

/**
 * Extended board with related data
 */
export interface BoardWithDetails extends Board {
  postCount: number
}

/**
 * Board with post count statistics (for public endpoints)
 */
export interface BoardWithStats extends Board {
  postCount: number
}
