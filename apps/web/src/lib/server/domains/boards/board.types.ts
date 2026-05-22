/**
 * Input/Output types for BoardService operations
 */

import type { Board, BoardSettings, BoardAudience } from '@/lib/server/db'

/**
 * Input for creating a new board.
 *
 * Audience defaults to { kind: 'public' } when omitted — the historical
 * isPublic=true default. For non-public boards on create, pass an explicit
 * audience.
 */
export interface CreateBoardInput {
  name: string
  description?: string | null
  slug?: string // If not provided, will be auto-generated from name
  audience?: BoardAudience
  settings?: BoardSettings
}

/**
 * Input for updating an existing board.
 *
 * audience is intentionally absent — visibility is a policy-level change,
 * admin-only and audited via updateBoardAccessFn. Keeping it out of this
 * type makes passing audience to updateBoard a compile error.
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
