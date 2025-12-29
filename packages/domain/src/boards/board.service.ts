/**
 * BoardService - Business logic for board operations
 *
 * This service handles all board-related business logic including:
 * - Board creation and updates
 * - Slug generation and uniqueness validation
 * - Settings management
 * - Validation and authorization
 */

import {
  db,
  type Board,
  type BoardSettings,
  eq,
  posts,
  boards,
  sql,
  inArray,
  asc,
} from '@quackback/db'
import type { BoardId, PostId } from '@quackback/ids'
import type { ServiceContext } from '../shared/service-context'
import { ok, err, type Result } from '../shared/result'
import { BoardError } from './board.errors'
import type { CreateBoardInput, UpdateBoardInput, BoardWithDetails } from './board.types'

/**
 * Generate a URL-friendly slug from a string
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Service class for board domain operations
 */
export class BoardService {
  /**
   * Create a new board
   *
   * Validates that:
   * - User has permission to create boards (team members only)
   * - Board name is valid
   * - Generated/provided slug is unique
   * - Input data is valid
   *
   * @param input - Board creation data
   * @param ctx - Service context with user information
   * @returns Result containing the created board or an error
   */
  async createBoard(
    input: CreateBoardInput,
    ctx: ServiceContext
  ): Promise<Result<Board, BoardError>> {
    return db.transaction(async (tx) => {
      // Authorization check - only team members (owner, admin, member) can create boards
      if (!['owner', 'admin', 'member'].includes(ctx.memberRole)) {
        return err(BoardError.unauthorized('create boards'))
      }

      // Validate input
      if (!input.name?.trim()) {
        return err(BoardError.validationError('Board name is required'))
      }
      if (input.name.length > 100) {
        return err(BoardError.validationError('Board name must be 100 characters or less'))
      }
      if (input.description && input.description.length > 500) {
        return err(BoardError.validationError('Description must be 500 characters or less'))
      }

      // Generate or validate slug
      let slug = input.slug ? slugify(input.slug) : slugify(input.name)

      // Ensure slug is not empty after slugification
      if (!slug) {
        return err(BoardError.validationError('Could not generate valid slug from name'))
      }

      // Check for slug uniqueness and generate a unique one if needed
      let counter = 0
      let isUnique = false
      const baseSlug = slug

      while (!isUnique) {
        const existingBoard = await tx.query.boards.findFirst({
          where: eq(boards.slug, slug),
        })
        if (!existingBoard) {
          isUnique = true
        } else {
          counter++
          slug = `${baseSlug}-${counter}`
        }
      }

      // Create the board
      const [board] = await tx
        .insert(boards)
        .values({
          name: input.name.trim(),
          slug,
          description: input.description?.trim() || null,
          isPublic: input.isPublic ?? true, // default to public
          settings: input.settings || {},
        })
        .returning()

      return ok(board)
    })
  }

  /**
   * Update an existing board
   *
   * Validates that:
   * - Board exists
   * - User has permission to update the board (team members only)
   * - Update data is valid
   * - New slug (if provided) is unique
   *
   * @param id - Board ID to update
   * @param input - Update data
   * @param ctx - Service context with user information
   * @returns Result containing the updated board or an error
   */
  async updateBoard(
    id: BoardId,
    input: UpdateBoardInput,
    ctx: ServiceContext
  ): Promise<Result<Board, BoardError>> {
    return db.transaction(async (tx) => {
      // Get existing board
      const existingBoard = await tx.query.boards.findFirst({
        where: eq(boards.id, id),
      })
      if (!existingBoard) {
        return err(BoardError.notFound(id))
      }

      // Authorization check - only team members can update boards
      if (!['owner', 'admin', 'member'].includes(ctx.memberRole)) {
        return err(BoardError.unauthorized('update boards'))
      }

      // Validate input
      if (input.name !== undefined) {
        if (!input.name.trim()) {
          return err(BoardError.validationError('Board name cannot be empty'))
        }
        if (input.name.length > 100) {
          return err(BoardError.validationError('Board name must be 100 characters or less'))
        }
      }
      if (input.description !== undefined && input.description !== null) {
        if (input.description.length > 500) {
          return err(BoardError.validationError('Description must be 500 characters or less'))
        }
      }

      // Handle slug update
      let slug = existingBoard.slug
      if (input.slug !== undefined) {
        slug = slugify(input.slug)

        if (!slug) {
          return err(BoardError.validationError('Could not generate valid slug'))
        }

        // Check uniqueness if slug is changing
        if (slug !== existingBoard.slug) {
          const existingWithSlug = await tx.query.boards.findFirst({
            where: eq(boards.slug, slug),
          })
          if (existingWithSlug && existingWithSlug.id !== id) {
            return err(BoardError.duplicateSlug(slug))
          }
        }
      } else if (input.name !== undefined) {
        // Auto-update slug if name changes but slug is not explicitly provided
        const newSlug = slugify(input.name)
        if (newSlug !== existingBoard.slug) {
          const existingWithSlug = await tx.query.boards.findFirst({
            where: eq(boards.slug, newSlug),
          })
          if (!existingWithSlug || existingWithSlug.id === id) {
            slug = newSlug
          }
        }
      }

      // Build update data
      const updateData: Partial<Board> = {}
      if (input.name !== undefined) updateData.name = input.name.trim()
      if (input.description !== undefined)
        updateData.description = input.description?.trim() || null
      if (slug !== existingBoard.slug) updateData.slug = slug
      if (input.isPublic !== undefined) updateData.isPublic = input.isPublic
      if (input.settings !== undefined) updateData.settings = input.settings

      // Update the board
      const [updatedBoard] = await tx
        .update(boards)
        .set({ ...updateData, updatedAt: new Date() })
        .where(eq(boards.id, id))
        .returning()

      if (!updatedBoard) {
        return err(BoardError.notFound(id))
      }

      return ok(updatedBoard)
    })
  }

  /**
   * Delete a board
   *
   * Validates that:
   * - Board exists
   * - User has permission to delete the board (owner/admin only)
   *
   * @param id - Board ID to delete
   * @param ctx - Service context with user information
   * @returns Result containing void or an error
   */
  async deleteBoard(id: BoardId, ctx: ServiceContext): Promise<Result<void, BoardError>> {
    return db.transaction(async (tx) => {
      // Get existing board
      const existingBoard = await tx.query.boards.findFirst({
        where: eq(boards.id, id),
      })
      if (!existingBoard) {
        return err(BoardError.notFound(id))
      }

      // Authorization check - only owners and admins can delete boards
      if (!['owner', 'admin'].includes(ctx.memberRole)) {
        return err(BoardError.unauthorized('delete boards'))
      }

      // Delete the board
      const result = await tx.delete(boards).where(eq(boards.id, id)).returning()
      if (result.length === 0) {
        return err(BoardError.notFound(id))
      }

      return ok(undefined)
    })
  }

  /**
   * Get a board by ID
   *
   * @param id - Board ID to fetch
   * @param ctx - Service context with user information
   * @returns Result containing the board or an error
   */
  async getBoardById(id: BoardId, _ctx: ServiceContext): Promise<Result<Board, BoardError>> {
    const board = await db.query.boards.findFirst({
      where: eq(boards.id, id),
    })
    if (!board) {
      return err(BoardError.notFound(id))
    }

    return ok(board)
  }

  /**
   * Get a board by slug
   *
   * @param slug - Board slug to fetch
   * @param ctx - Service context with user information
   * @returns Result containing the board or an error
   */
  async getBoardBySlug(slug: string, _ctx: ServiceContext): Promise<Result<Board, BoardError>> {
    const board = await db.query.boards.findFirst({
      where: eq(boards.slug, slug),
    })
    if (!board) {
      return err(BoardError.notFound(slug))
    }

    return ok(board)
  }

  /**
   * List all boards
   *
   * @param ctx - Service context with user information
   * @returns Result containing array of boards or an error
   */
  async listBoards(_ctx: ServiceContext): Promise<Result<Board[], BoardError>> {
    const boardList = await db.query.boards.findMany({
      orderBy: [asc(boards.name)],
    })
    return ok(boardList)
  }

  /**
   * List all boards with post counts
   *
   * @param ctx - Service context with user information
   * @returns Result containing array of boards with details or an error
   */
  async listBoardsWithDetails(
    _ctx: ServiceContext
  ): Promise<Result<BoardWithDetails[], BoardError>> {
    // Get all boards ordered by name
    const allBoards = await db.query.boards.findMany({
      orderBy: [asc(boards.name)],
    })

    if (allBoards.length === 0) {
      return ok([])
    }

    // Get post counts for all boards
    const boardIds = allBoards.map((b) => b.id)
    const postCounts = await db
      .select({
        boardId: posts.boardId,
        count: sql<number>`count(*)`.as('count'),
      })
      .from(posts)
      .where(inArray(posts.boardId, boardIds))
      .groupBy(posts.boardId)

    // Create a map of board ID -> post count
    const postCountMap = new Map(postCounts.map((pc) => [pc.boardId, Number(pc.count)]))

    // Return boards with post counts
    const boardsWithDetails = allBoards.map((board) => ({
      ...board,
      postCount: postCountMap.get(board.id) ?? 0,
    }))

    return ok(boardsWithDetails)
  }

  /**
   * Update board settings
   *
   * Validates that:
   * - Board exists
   * - User has permission to update settings (team members only)
   *
   * @param id - Board ID to update
   * @param settings - New settings to merge with existing settings
   * @param ctx - Service context with user information
   * @returns Result containing the updated board or an error
   */
  async updateBoardSettings(
    id: BoardId,
    settings: BoardSettings,
    ctx: ServiceContext
  ): Promise<Result<Board, BoardError>> {
    return db.transaction(async (tx) => {
      // Get existing board
      const existingBoard = await tx.query.boards.findFirst({
        where: eq(boards.id, id),
      })
      if (!existingBoard) {
        return err(BoardError.notFound(id))
      }

      // Authorization check - only team members can update settings
      if (!['owner', 'admin', 'member'].includes(ctx.memberRole)) {
        return err(BoardError.unauthorized('update board settings'))
      }

      // Merge settings with existing settings
      const currentSettings = (existingBoard.settings || {}) as BoardSettings
      const updatedSettings = {
        ...currentSettings,
        ...settings,
      }

      // Update the board
      const [updatedBoard] = await tx
        .update(boards)
        .set({ settings: updatedSettings, updatedAt: new Date() })
        .where(eq(boards.id, id))
        .returning()

      if (!updatedBoard) {
        return err(BoardError.notFound(id))
      }

      return ok(updatedBoard)
    })
  }

  /**
   * Get a board by post ID
   *
   * Finds the post and returns its associated board.
   * Requires authentication context.
   *
   * @param postId - Post ID to lookup
   * @param ctx - Service context with user information
   * @returns Result containing the board or an error
   */
  async getBoardByPostId(postId: PostId, _ctx: ServiceContext): Promise<Result<Board, BoardError>> {
    // Find the post first
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
    })

    if (!post) {
      return err(BoardError.notFound(`Post with ID ${postId}`))
    }

    // Get the board
    const board = await db.query.boards.findFirst({
      where: eq(boards.id, post.boardId),
    })
    if (!board) {
      return err(BoardError.notFound(post.boardId))
    }

    return ok(board)
  }
}

/**
 * Singleton instance of BoardService
 * Export as default for easy importing
 */
export const boardService = new BoardService()
