/**
 * Board domain module exports
 */

export { BoardService, boardService } from './board.service'
export { BoardError } from './board.errors'
export type { BoardErrorCode } from './board.errors'
export type {
  CreateBoardInput,
  UpdateBoardInput,
  BoardWithDetails,
  BoardWithStats,
} from './board.types'
