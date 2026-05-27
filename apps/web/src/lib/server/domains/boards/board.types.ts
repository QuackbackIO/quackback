/**
 * Input/Output types for BoardService operations
 */

import type { Board, BoardSettings, BoardAccess } from '@/lib/server/db'

/**
 * Input for creating a new board.
 *
 * Access defaults to DEFAULT_BOARD_ACCESS (all-anonymous, approval off)
 * when omitted. For richer choices on create, pass an explicit access matrix.
 */
export interface CreateBoardInput {
  name: string
  description?: string | null
  slug?: string // If not provided, will be auto-generated from name
  access?: BoardAccess
  settings?: BoardSettings
}

/**
 * Input for updating an existing board.
 *
 * access is intentionally absent — visibility is a policy-level change,
 * admin-only and audited via updateBoardAccessFn. Keeping it out of this
 * type makes passing access to updateBoard a compile error.
 */
export interface UpdateBoardInput {
  name?: string
  description?: string | null
  slug?: string
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
