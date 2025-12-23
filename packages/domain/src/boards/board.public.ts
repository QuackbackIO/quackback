/**
 * PublicBoardService - Read-only operations that don't require authentication
 *
 * This service handles all public-facing board operations including:
 * - Listing public boards
 * - Getting public board details
 * - Board counts for onboarding
 *
 * All methods in this file are safe for unauthenticated access.
 */

import { db, eq, sql, inArray, boards, posts, type Board } from '@quackback/db'
import type { BoardId } from '@quackback/ids'
import { ok, err, type Result } from '../shared/result'
import { BoardError } from './board.errors'
import type { BoardWithStats } from './board.types'

/**
 * Service class for public board operations (no authentication required)
 */
export class PublicBoardService {
  /**
   * Get a public board by ID
   *
   * This method is used for public endpoints like post creation.
   *
   * @param boardId - Board ID to fetch
   * @returns Result containing the board or an error
   */
  async getBoardById(boardId: BoardId): Promise<Result<Board, BoardError>> {
    try {
      const board = await db.query.boards.findFirst({
        where: eq(boards.id, boardId),
      })

      if (!board) {
        return err(BoardError.notFound(boardId))
      }

      return ok(board)
    } catch (error) {
      return err(
        BoardError.validationError(
          `Failed to fetch board: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * List all public boards with post counts
   *
   * Only returns boards where isPublic = true.
   *
   * @returns Result containing array of public boards with stats or an error
   */
  async listBoardsWithStats(): Promise<Result<BoardWithStats[], BoardError>> {
    try {
      // Fetch all public boards
      const publicBoards = await db.query.boards.findMany({
        where: eq(boards.isPublic, true),
        orderBy: (boards, { asc }) => [asc(boards.name)],
      })

      if (publicBoards.length === 0) {
        return ok([])
      }

      // Get post counts for all boards
      const boardIds = publicBoards.map((b) => b.id)
      const postCounts = await db
        .select({
          boardId: posts.boardId,
          count: sql<number>`count(*)`.as('count'),
        })
        .from(posts)
        .where(inArray(posts.boardId, boardIds))
        .groupBy(posts.boardId)

      const postCountMap = new Map(postCounts.map((pc) => [pc.boardId, Number(pc.count)]))

      // Combine boards with post counts
      const boardsWithStats: BoardWithStats[] = publicBoards.map((board) => ({
        ...board,
        postCount: postCountMap.get(board.id) ?? 0,
      }))

      return ok(boardsWithStats)
    } catch (error) {
      return err(
        BoardError.validationError(
          `Failed to fetch public boards: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Get a public board by slug
   *
   * Only returns boards where isPublic = true.
   *
   * @param slug - Board slug to fetch
   * @returns Result containing the board or null if not found/not public
   */
  async getBoardBySlug(slug: string): Promise<Result<Board | null, BoardError>> {
    try {
      const board = await db.query.boards.findFirst({
        where: (boards, { and, eq }) => and(eq(boards.slug, slug), eq(boards.isPublic, true)),
      })

      return ok(board || null)
    } catch (error) {
      return err(
        BoardError.validationError(
          `Failed to fetch board: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Count all boards (public and private)
   *
   * Used by onboarding/getting-started pages.
   *
   * @returns Result containing the board count
   */
  async countBoards(): Promise<Result<number, BoardError>> {
    try {
      const result = await db.select({ count: sql<number>`count(*)`.as('count') }).from(boards)

      return ok(Number(result[0]?.count ?? 0))
    } catch (error) {
      return err(
        BoardError.validationError(
          `Failed to count boards: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Validate that a board exists
   *
   * This is a lightweight validation method used for import/export operations.
   *
   * @param boardId - Board ID to validate
   * @returns Result containing the board if valid, or an error
   */
  async validateBoardExists(boardId: BoardId): Promise<Result<Board, BoardError>> {
    try {
      const board = await db.query.boards.findFirst({
        where: eq(boards.id, boardId),
      })

      if (!board) {
        return err(BoardError.notFound(`Board ${boardId} not found`))
      }

      return ok(board)
    } catch (error) {
      return err(
        BoardError.validationError(
          `Failed to validate board: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }
}

/**
 * Singleton instance of PublicBoardService
 */
export const publicBoardService = new PublicBoardService()
