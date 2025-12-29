/**
 * Board domain module exports
 */

// BoardService functions (require authentication context)
export {
  createBoard,
  updateBoard,
  deleteBoard,
  getBoardById,
  getBoardBySlug,
  listBoards,
  listBoardsWithDetails,
  updateBoardSettings,
  getBoardByPostId,
} from './board.service'

// PublicBoardService functions (no authentication required)
export {
  getPublicBoardById,
  listPublicBoardsWithStats,
  getPublicBoardBySlug,
  countBoards,
  validateBoardExists,
} from './board.public'

export { BoardError } from './board.errors'
export type { BoardErrorCode } from './board.errors'
export type {
  CreateBoardInput,
  UpdateBoardInput,
  BoardWithDetails,
  BoardWithStats,
} from './board.types'
