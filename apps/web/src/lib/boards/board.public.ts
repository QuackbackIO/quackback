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
import { NotFoundError, InternalError } from '@/lib/shared/errors'
import type { BoardWithStats } from './board.types'

/**
 * Get a public board by ID
 */
export async function getPublicBoardById(boardId: BoardId): Promise<Board> {
  try {
    const board = await db.query.boards.findFirst({
      where: eq(boards.id, boardId),
    })

    if (!board) {
      throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${boardId} not found`)
    }

    return board
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    throw new InternalError(
      'DATABASE_ERROR',
      `Failed to fetch board: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}

/**
 * List all public boards with post counts
 */
export async function listPublicBoardsWithStats(): Promise<BoardWithStats[]> {
  try {
    // Fetch all public boards
    const publicBoards = await db.query.boards.findMany({
      where: eq(boards.isPublic, true),
      orderBy: (boards, { asc }) => [asc(boards.name)],
    })

    if (publicBoards.length === 0) {
      return []
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

    return boardsWithStats
  } catch (error) {
    throw new InternalError(
      'DATABASE_ERROR',
      `Failed to fetch public boards: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}

/**
 * Get a public board by slug
 */
export async function getPublicBoardBySlug(slug: string): Promise<Board | null> {
  try {
    const board = await db.query.boards.findFirst({
      where: (boards, { and, eq }) => and(eq(boards.slug, slug), eq(boards.isPublic, true)),
    })

    return board || null
  } catch (error) {
    throw new InternalError(
      'DATABASE_ERROR',
      `Failed to fetch board: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}

/**
 * Count all boards (public and private)
 */
export async function countBoards(): Promise<number> {
  try {
    const result = await db.select({ count: sql<number>`count(*)`.as('count') }).from(boards)

    return Number(result[0]?.count ?? 0)
  } catch (error) {
    throw new InternalError(
      'DATABASE_ERROR',
      `Failed to count boards: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}

/**
 * Validate that a board exists
 */
export async function validateBoardExists(boardId: BoardId): Promise<Board> {
  try {
    const board = await db.query.boards.findFirst({
      where: eq(boards.id, boardId),
    })

    if (!board) {
      throw new NotFoundError('BOARD_NOT_FOUND', `Board ${boardId} not found`)
    }

    return board
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    throw new InternalError(
      'DATABASE_ERROR',
      `Failed to validate board: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}
