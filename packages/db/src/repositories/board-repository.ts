import { eq, sql, inArray } from 'drizzle-orm'
import type { BoardId } from '@quackback/ids'
import type { Database } from '../client'
import { boards } from '../schema/boards'
import { posts } from '../schema/posts'
import type { Board, NewBoard } from '../types'

/**
 * BoardRepository - Data access layer for boards
 *
 * This repository provides low-level database operations for boards.
 * It does NOT include business logic, validation, or authorization.
 * Use domain services for business rules and validation.
 */
export class BoardRepository {
  constructor(private readonly db: Database) {}

  /**
   * Find a board by ID
   */
  async findById(id: BoardId): Promise<Board | null> {
    const board = await this.db.query.boards.findFirst({
      where: eq(boards.id, id),
    })
    return board ?? null
  }

  /**
   * Find a board by slug
   */
  async findBySlug(slug: string): Promise<Board | null> {
    const board = await this.db.query.boards.findFirst({
      where: eq(boards.slug, slug),
    })
    return board ?? null
  }

  /**
   * Find all boards with optional pagination
   */
  async findAll(options?: { limit?: number; offset?: number }): Promise<Board[]> {
    const { limit, offset } = options ?? {}

    return this.db.query.boards.findMany({
      orderBy: (boards, { asc }) => [asc(boards.name)],
      limit,
      offset,
    })
  }

  /**
   * Create a new board
   */
  async create(data: NewBoard): Promise<Board> {
    const [board] = await this.db.insert(boards).values(data).returning()
    return board
  }

  /**
   * Update a board by ID
   */
  async update(id: BoardId, data: Partial<Board>): Promise<Board | null> {
    const [updated] = await this.db
      .update(boards)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(boards.id, id))
      .returning()

    return updated ?? null
  }

  /**
   * Delete a board by ID
   */
  async delete(id: BoardId): Promise<boolean> {
    const result = await this.db.delete(boards).where(eq(boards.id, id)).returning()
    return result.length > 0
  }

  /**
   * Find all boards with their post counts
   */
  async findWithPostCount(): Promise<(Board & { postCount: number })[]> {
    const allBoards = await this.db.query.boards.findMany({
      orderBy: (boards, { asc }) => [asc(boards.name)],
    })

    if (allBoards.length === 0) {
      return []
    }

    const boardIds = allBoards.map((b) => b.id)

    const postCounts = await this.db
      .select({
        boardId: posts.boardId,
        count: sql<number>`count(*)`.as('count'),
      })
      .from(posts)
      .where(inArray(posts.boardId, boardIds))
      .groupBy(posts.boardId)

    const postCountMap = new Map(postCounts.map((pc) => [pc.boardId, Number(pc.count)]))

    return allBoards.map((board) => ({
      ...board,
      postCount: postCountMap.get(board.id) ?? 0,
    }))
  }
}
