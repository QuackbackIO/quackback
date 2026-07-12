/**
 * BoardService - Business logic for board operations
 *
 * This service handles all board-related business logic including:
 * - Board creation and updates
 * - Slug generation and uniqueness validation
 * - Settings management
 * - Validation
 */

import {
  db,
  type Board,
  type BoardSettings,
  eq,
  and,
  isNull,
  posts,
  boards,
  webhooks,
  sql,
  inArray,
  asc,
} from '@/lib/server/db'
import type { BoardId, PostId } from '@quackback/ids'
import { emitBestEffort } from '@/lib/server/events/emit'
import { boardCreated, boardDeleted } from '@/lib/server/events/catalogue'
import { NotFoundError, ValidationError, ConflictError } from '@/lib/shared/errors'
import type { CreateBoardInput, UpdateBoardInput, BoardWithDetails } from './board.types'
import { slugify } from '@/lib/shared/utils'
import { type BoardAccess } from '@/lib/server/db'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'

/**
 * Legacy API-contract shape — derived from BoardAccess for backward
 * compatibility with the REST `/api/v1/boards*` endpoints. The internal
 * data model no longer stores audience; this helper synthesises the old
 * discriminated union from the current access matrix so external clients
 * keep working. New code should consume `BoardAccess` directly.
 */
export type LegacyBoardAudience =
  | { kind: 'public' }
  | { kind: 'authenticated' }
  | { kind: 'team' }
  | { kind: 'segments'; segmentIds: string[] }

/**
 * Derive a legacy BoardAudience from the current BoardAccess. We collapse
 * the three-action matrix onto `view` — that's the historical meaning of
 * "audience" (who can see the board). Boards with mixed tiers map to the
 * view tier; non-view restrictions (e.g. team-only comment on a public
 * board) aren't expressible in the legacy shape. Likewise the segments
 * list reflects the view-action allowlist only.
 */
export function accessToAudience(access: BoardAccess): LegacyBoardAudience {
  switch (access.view) {
    case 'anonymous':
      return { kind: 'public' }
    case 'authenticated':
      return { kind: 'authenticated' }
    case 'segments':
      return { kind: 'segments', segmentIds: access.segments.view }
    case 'team':
      return { kind: 'team' }
    default:
      return { kind: 'public' }
  }
}
import { enforceCountLimit } from '@/lib/server/domains/settings/tier-enforce'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'boards' })

// Slug base for names that romanize to nothing even after transliteration
// (emoji- or punctuation-only). The uniqueness loop disambiguates ("board",
// "board-1", ...). Without it such names yield an empty slug, which breaks
// the NOT NULL UNIQUE column and crashes slug-keyed <Select.Item> (#285).
const FALLBACK_BOARD_SLUG = 'board'

/**
 * Create a new board
 */
export async function createBoard(input: CreateBoardInput): Promise<Board> {
  // Validate input before the tier gate — invalid input doesn't deserve a
  // count(*) query.
  if (!input.name?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Board name is required')
  }
  if (input.name.length > 100) {
    throw new ValidationError('VALIDATION_ERROR', 'Board name must be 100 characters or less')
  }
  if (input.description && input.description.length > 500) {
    throw new ValidationError('VALIDATION_ERROR', 'Description must be 500 characters or less')
  }

  // Tier-limit gate (no-op in OSS).
  const limits = await getTierLimits()
  await enforceCountLimit({
    limit: limits.maxBoards,
    name: 'maxBoards',
    friendly: 'boards',
    currentCount: async () => {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(boards)
        .where(isNull(boards.deletedAt))
      return row?.count ?? 0
    },
  })

  // Derive the slug. An explicit slug that slugifies to nothing is a caller
  // error worth rejecting (mirrors updateBoard, and avoids silently turning
  // e.g. slug "---" into a generic "board"); only a name-derived slug falls
  // back to a generic base so any-language name can still create a board.
  let baseSlug: string
  if (input.slug) {
    baseSlug = slugify(input.slug)
    if (!baseSlug) {
      throw new ValidationError('VALIDATION_ERROR', 'Could not generate valid slug from name')
    }
  } else {
    baseSlug = slugify(input.name) || FALLBACK_BOARD_SLUG
  }

  // Check for slug uniqueness and generate a unique one if needed
  let slug = baseSlug
  let counter = 0

  while (true) {
    const existingBoard = await db.query.boards.findFirst({
      where: eq(boards.slug, slug),
    })
    if (!existingBoard) {
      break
    }
    counter++
    slug = `${baseSlug}-${counter}`
  }

  // Create the board. Access defaults to the column default
  // (DEFAULT_BOARD_ACCESS — all-anonymous, approval off) when omitted;
  // richer choices can be set here on create or changed later via
  // updateBoardAccessFn (admin-only, audited).
  const insertValues: {
    name: string
    slug: string
    description: string | null
    settings: BoardSettings
    access?: BoardAccess
  } = {
    name: input.name.trim(),
    slug,
    description: input.description?.trim() || null,
    settings: input.settings || {},
  }
  if (input.access) {
    insertValues.access = input.access
  }

  const [board] = await db.insert(boards).values(insertValues).returning()

  // WO-6b: audit-relevant board creation event (best-effort, post-mutation).
  void emitBestEffort(boardCreated, {
    payload: { boardId: board.id, name: board.name, slug: board.slug },
    actor: { type: 'service' },
    entityId: board.id,
    context: { source: 'admin' },
  })

  return board
}

/**
 * Update an existing board
 */
export async function updateBoard(id: BoardId, input: UpdateBoardInput): Promise<Board> {
  // Get existing board
  const existingBoard = await db.query.boards.findFirst({
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
      const existingWithSlug = await db.query.boards.findFirst({
        where: eq(boards.slug, slug),
      })
      if (existingWithSlug && existingWithSlug.id !== id) {
        throw new ConflictError('DUPLICATE_SLUG', `A board with slug "${slug}" already exists`)
      }
    }
  } else if (input.name !== undefined) {
    // Auto-update slug when the name changes and no slug was given, never empty.
    const newSlug = slugify(input.name) || FALLBACK_BOARD_SLUG
    if (newSlug !== existingBoard.slug) {
      const existingWithSlug = await db.query.boards.findFirst({
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
  if (input.settings !== undefined) updateData.settings = input.settings

  // Update the board
  const [updatedBoard] = await db
    .update(boards)
    .set({ ...updateData, updatedAt: new Date() })
    .where(eq(boards.id, id))
    .returning()

  if (!updatedBoard) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${id} not found`)
  }

  return updatedBoard
}

/**
 * Soft delete a board
 *
 * Sets deletedAt timestamp instead of removing the row.
 * Also removes the board ID from webhook board_ids filters to maintain referential integrity.
 */
export async function deleteBoard(id: BoardId): Promise<void> {
  // Soft delete the board by setting deletedAt
  const result = await db
    .update(boards)
    .set({ deletedAt: new Date() })
    .where(and(eq(boards.id, id), isNull(boards.deletedAt)))
    .returning()

  if (result.length === 0) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${id} not found`)
  }

  // WO-6b: audit-relevant board deletion event.
  void emitBestEffort(boardDeleted, {
    payload: { boardId: id },
    actor: { type: 'service' },
    entityId: id,
    context: { source: 'admin' },
  })

  // Clean up webhook board_ids references (fire-and-forget)
  // Removes deleted board ID from any webhook filters
  db.update(webhooks)
    .set({
      boardIds: sql`array_remove(${webhooks.boardIds}, ${id})`,
      updatedAt: new Date(),
    })
    .where(sql`${webhooks.boardIds} @> ARRAY[${id}]::text[]`)
    .execute()
    .catch((error) => {
      log.error({ err: error }, 'failed to clean up webhook board_ids')
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
 * List all boards (excludes soft-deleted)
 */
export async function listBoards(): Promise<Board[]> {
  const boardList = await db.query.boards.findMany({
    where: isNull(boards.deletedAt),
    orderBy: [asc(boards.name)],
  })
  return boardList
}

/**
 * List all boards with post counts (excludes soft-deleted)
 */
export async function listBoardsWithDetails(): Promise<BoardWithDetails[]> {
  // Get all active boards ordered by name
  const allBoards = await db.query.boards.findMany({
    where: isNull(boards.deletedAt),
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
    .where(and(inArray(posts.boardId, boardIds), sql`${posts.deletedAt} IS NULL`))
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
  // Get existing board
  const existingBoard = await db.query.boards.findFirst({
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
  const [updatedBoard] = await db
    .update(boards)
    .set({ settings: updatedSettings, updatedAt: new Date() })
    .where(eq(boards.id, id))
    .returning()

  if (!updatedBoard) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${id} not found`)
  }

  return updatedBoard
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
