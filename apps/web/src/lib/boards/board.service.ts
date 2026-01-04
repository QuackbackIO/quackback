/**
 * BoardService - Business logic for board operations
 *
 * This service handles all board-related business logic including:
 * - Board creation and updates
 * - Slug generation and uniqueness validation
 * - Settings management
 * - Validation
 */

import { db, type Board, type BoardSettings, eq, posts, boards, sql, inArray, asc } from '@/lib/db'
import type { BoardId, PostId } from '@quackback/ids'
import { NotFoundError, ValidationError, ConflictError } from '@/lib/shared/errors'
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
 * Create a new board
 */
export async function createBoard(input: CreateBoardInput): Promise<Board> {
  return db.transaction(async (tx) => {
    // Validate input
    if (!input.name?.trim()) {
      throw new ValidationError('VALIDATION_ERROR', 'Board name is required')
    }
    if (input.name.length > 100) {
      throw new ValidationError('VALIDATION_ERROR', 'Board name must be 100 characters or less')
    }
    if (input.description && input.description.length > 500) {
      throw new ValidationError('VALIDATION_ERROR', 'Description must be 500 characters or less')
    }

    // Generate or validate slug
    let slug = input.slug ? slugify(input.slug) : slugify(input.name)

    // Ensure slug is not empty after slugification
    if (!slug) {
      throw new ValidationError('VALIDATION_ERROR', 'Could not generate valid slug from name')
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

    return board
  })
}

/**
 * Update an existing board
 */
export async function updateBoard(id: BoardId, input: UpdateBoardInput): Promise<Board> {
  return db.transaction(async (tx) => {
    // Get existing board
    const existingBoard = await tx.query.boards.findFirst({
      where: eq(boards.id, id),
    })
    if (!existingBoard) {
      throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${id} not found`)
    }

    // Validate input
    if (input.name !== undefined) {
      if (!input.name.trim()) {
        throw new ValidationError('VALIDATION_ERROR', 'Board name cannot be empty')
      }
      if (input.name.length > 100) {
        throw new ValidationError('VALIDATION_ERROR', 'Board name must be 100 characters or less')
      }
    }
    if (input.description !== undefined && input.description !== null) {
      if (input.description.length > 500) {
        throw new ValidationError('VALIDATION_ERROR', 'Description must be 500 characters or less')
      }
    }

    // Handle slug update
    let slug = existingBoard.slug
    if (input.slug !== undefined) {
      slug = slugify(input.slug)

      if (!slug) {
        throw new ValidationError('VALIDATION_ERROR', 'Could not generate valid slug')
      }

      // Check uniqueness if slug is changing
      if (slug !== existingBoard.slug) {
        const existingWithSlug = await tx.query.boards.findFirst({
          where: eq(boards.slug, slug),
        })
        if (existingWithSlug && existingWithSlug.id !== id) {
          throw new ConflictError('DUPLICATE_SLUG', `A board with slug "${slug}" already exists`)
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
    if (input.description !== undefined) updateData.description = input.description?.trim() || null
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
      throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${id} not found`)
    }

    return updatedBoard
  })
}

/**
 * Delete a board
 */
export async function deleteBoard(id: BoardId): Promise<void> {
  return db.transaction(async (tx) => {
    // Get existing board
    const existingBoard = await tx.query.boards.findFirst({
      where: eq(boards.id, id),
    })
    if (!existingBoard) {
      throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${id} not found`)
    }

    // Delete the board
    const result = await tx.delete(boards).where(eq(boards.id, id)).returning()
    if (result.length === 0) {
      throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${id} not found`)
    }
  })
}

/**
 * Get a board by ID
 */
export async function getBoardById(id: BoardId): Promise<Board> {
  const board = await db.query.boards.findFirst({
    where: eq(boards.id, id),
  })
  if (!board) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${id} not found`)
  }

  return board
}

/**
 * Get a board by slug
 */
export async function getBoardBySlug(slug: string): Promise<Board> {
  const board = await db.query.boards.findFirst({
    where: eq(boards.slug, slug),
  })
  if (!board) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with slug "${slug}" not found`)
  }

  return board
}

/**
 * List all boards
 */
export async function listBoards(): Promise<Board[]> {
  const boardList = await db.query.boards.findMany({
    orderBy: [asc(boards.name)],
  })
  return boardList
}

/**
 * List all boards with post counts
 */
export async function listBoardsWithDetails(): Promise<BoardWithDetails[]> {
  // Get all boards ordered by name
  const allBoards = await db.query.boards.findMany({
    orderBy: [asc(boards.name)],
  })

  if (allBoards.length === 0) {
    return []
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

  return boardsWithDetails
}

/**
 * Update board settings
 */
export async function updateBoardSettings(id: BoardId, settings: BoardSettings): Promise<Board> {
  return db.transaction(async (tx) => {
    // Get existing board
    const existingBoard = await tx.query.boards.findFirst({
      where: eq(boards.id, id),
    })
    if (!existingBoard) {
      throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${id} not found`)
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
      throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${id} not found`)
    }

    return updatedBoard
  })
}

/**
 * Get a board by post ID
 */
export async function getBoardByPostId(postId: PostId): Promise<Board> {
  // Find the post first
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
  })

  if (!post) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  // Get the board
  const board = await db.query.boards.findFirst({
    where: eq(boards.id, post.boardId),
  })
  if (!board) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${post.boardId} not found`)
  }

  return board
}
