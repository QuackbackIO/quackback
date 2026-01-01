/**
 * Board domain module exports
 *
 * IMPORTANT: This barrel export only includes types and error classes.
 * Service functions that access the database are NOT exported here to prevent
 * them from being bundled into the client.
 *
 * For service functions, import directly from './board.service' or './board.public'
 * in server-only code (server functions, API routes, etc.)
 */

// Error classes (no DB dependency)
export { BoardError } from './board.errors'
export type { BoardErrorCode } from './board.errors'

// Types (no DB dependency)
export type {
  CreateBoardInput,
  UpdateBoardInput,
  BoardWithDetails,
  BoardWithStats,
} from './board.types'
