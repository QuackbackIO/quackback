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
  withUnitOfWork,
  BoardRepository,
  type Board,
  type UnitOfWork,
  type BoardSettings,
  db,
  eq,
  sql,
  inArray,
  boards,
  posts,
} from '@quackback/db'
import type { BoardId, PostId } from '@quackback/ids'
import type { ServiceContext } from '../shared/service-context'
import { ok, err, type Result } from '../shared/result'
import { BoardError } from './board.errors'
import type {
  CreateBoardInput,
  UpdateBoardInput,
  BoardWithDetails,
  BoardWithStats,
} from './board.types'

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
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const boardRepo = new BoardRepository(uow.db)

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
        const existingBoard = await boardRepo.findBySlug(slug)
        if (!existingBoard) {
          isUnique = true
        } else {
          counter++
          slug = `${baseSlug}-${counter}`
        }
      }

      // Create the board
      const board = await boardRepo.create({
        name: input.name.trim(),
        slug,
        description: input.description?.trim() || null,
        isPublic: input.isPublic ?? true, // default to public
        settings: input.settings || {},
      })

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
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const boardRepo = new BoardRepository(uow.db)

      // Get existing board
      const existingBoard = await boardRepo.findById(id)
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
          const existingWithSlug = await boardRepo.findBySlug(slug)
          if (existingWithSlug && existingWithSlug.id !== id) {
            return err(BoardError.duplicateSlug(slug))
          }
        }
      } else if (input.name !== undefined) {
        // Auto-update slug if name changes but slug is not explicitly provided
        const newSlug = slugify(input.name)
        if (newSlug !== existingBoard.slug) {
          const existingWithSlug = await boardRepo.findBySlug(newSlug)
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
      const updatedBoard = await boardRepo.update(id, updateData)
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
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const boardRepo = new BoardRepository(uow.db)

      // Get existing board
      const existingBoard = await boardRepo.findById(id)
      if (!existingBoard) {
        return err(BoardError.notFound(id))
      }

      // Authorization check - only owners and admins can delete boards
      if (!['owner', 'admin'].includes(ctx.memberRole)) {
        return err(BoardError.unauthorized('delete boards'))
      }

      // Delete the board
      const deleted = await boardRepo.delete(id)
      if (!deleted) {
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
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const boardRepo = new BoardRepository(uow.db)

      const board = await boardRepo.findById(id)
      if (!board) {
        return err(BoardError.notFound(id))
      }

      return ok(board)
    })
  }

  /**
   * Get a board by slug
   *
   * @param slug - Board slug to fetch
   * @param ctx - Service context with user information
   * @returns Result containing the board or an error
   */
  async getBoardBySlug(slug: string, _ctx: ServiceContext): Promise<Result<Board, BoardError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const boardRepo = new BoardRepository(uow.db)

      const board = await boardRepo.findBySlug(slug)
      if (!board) {
        return err(BoardError.notFound(slug))
      }

      return ok(board)
    })
  }

  /**
   * List all boards
   *
   * @param ctx - Service context with user information
   * @returns Result containing array of boards or an error
   */
  async listBoards(_ctx: ServiceContext): Promise<Result<Board[], BoardError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const boardRepo = new BoardRepository(uow.db)

      const boards = await boardRepo.findAll()
      return ok(boards)
    })
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
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const boardRepo = new BoardRepository(uow.db)

      const boards = await boardRepo.findWithPostCount()
      return ok(boards)
    })
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
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const boardRepo = new BoardRepository(uow.db)

      // Get existing board
      const existingBoard = await boardRepo.findById(id)
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
      const updatedBoard = await boardRepo.update(id, { settings: updatedSettings })
      if (!updatedBoard) {
        return err(BoardError.notFound(id))
      }

      return ok(updatedBoard)
    })
  }

  /**
   * Get a public board by ID (no authentication required)
   *
   * This method is used for public endpoints like post creation.
   *
   * @param boardId - Board ID to fetch
   * @returns Result containing the board or an error
   */
  async getPublicBoardById(boardId: BoardId): Promise<Result<Board, BoardError>> {
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
   * This method is used for public endpoints and does not require authentication.
   * Only returns boards where isPublic = true.
   *
   * @returns Result containing array of public boards with stats or an error
   */
  async listPublicBoardsWithStats(): Promise<Result<BoardWithStats[], BoardError>> {
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
   * Get a public board by slug (no authentication required)
   *
   * Only returns boards where isPublic = true.
   *
   * @param slug - Board slug to fetch
   * @returns Result containing the board or null if not found/not public
   */
  async getPublicBoardBySlug(slug: string): Promise<Result<Board | null, BoardError>> {
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
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const boardRepo = new BoardRepository(uow.db)

      // Find the post first
      const post = await uow.db.query.posts.findFirst({
        where: eq(posts.id, postId),
      })

      if (!post) {
        return err(BoardError.notFound(`Post with ID ${postId}`))
      }

      // Get the board
      const board = await boardRepo.findById(post.boardId)
      if (!board) {
        return err(BoardError.notFound(post.boardId))
      }

      return ok(board)
    })
  }

  /**
   * Count boards (no auth required)
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
 * Singleton instance of BoardService
 * Export as default for easy importing
 */
export const boardService = new BoardService()
