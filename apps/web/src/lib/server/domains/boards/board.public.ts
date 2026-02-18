import { db, eq, and, isNull, sql, boards, posts, type Board } from '@/lib/server/db'
import type { BoardId } from '@quackback/ids'
import { NotFoundError, InternalError } from '@/lib/shared/errors'
import type { BoardWithStats } from './board.types'

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

export async function listPublicBoardsWithStats(): Promise<BoardWithStats[]> {
  try {
    const result = await db
      .select({
        id: boards.id,
        slug: boards.slug,
        name: boards.name,
        description: boards.description,
        isPublic: boards.isPublic,
        settings: boards.settings,
        createdAt: boards.createdAt,
        updatedAt: boards.updatedAt,
        deletedAt: boards.deletedAt,
        postCount: sql<number>`count(${posts.id})::int`.as('post_count'),
      })
      .from(boards)
      .leftJoin(posts, and(eq(posts.boardId, boards.id), isNull(posts.deletedAt)))
      .where(and(eq(boards.isPublic, true), isNull(boards.deletedAt)))
      .groupBy(boards.id)
      .orderBy(boards.name)

    return result.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      isPublic: row.isPublic,
      settings: row.settings,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
      postCount: row.postCount ?? 0,
    }))
  } catch (error) {
    throw new InternalError(
      'DATABASE_ERROR',
      `Failed to fetch public boards: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}

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
