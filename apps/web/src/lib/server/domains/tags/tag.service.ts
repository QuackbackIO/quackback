/**
 * Tag Service - Business logic for tag operations
 *
 * This module handles all tag-related business logic including:
 * - Tag creation and updates
 * - Tag deletion
 * - Tag retrieval and listing
 * - Validation
 *
 * Note: Authorization is handled at the action/API layer, not in services.
 */

import { db, eq, asc, type Tag, tags, boards, postTags, posts } from '@/lib/db'
import { tenantStorage } from '@/lib/server/tenant'
import type { TagId, BoardId } from '@quackback/ids'
import { NotFoundError, ValidationError, ConflictError, InternalError } from '@/lib/shared/errors'
import type { CreateTagInput, UpdateTagInput } from './tag.types'

/**
 * Create a new tag
 *
 * Validates that:
 * - Tag name is valid and unique within the organization
 * - Color is valid
 *
 * Note: Authorization should be checked at the action/API layer before calling this.
 */
export async function createTag(input: CreateTagInput): Promise<Tag> {
  // Basic validation
  if (!input.name || !input.name.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Tag name is required')
  }

  const trimmedName = input.name.trim()

  if (trimmedName.length > 50) {
    throw new ValidationError('VALIDATION_ERROR', 'Tag name must not exceed 50 characters')
  }

  // Check for duplicate name in the organization
  const existingTags = await db.query.tags.findMany({
    orderBy: [asc(tags.name)],
  })
  const duplicate = existingTags.find((tag) => tag.name.toLowerCase() === trimmedName.toLowerCase())
  if (duplicate) {
    throw new ConflictError('DUPLICATE_NAME', `A tag with name "${trimmedName}" already exists`)
  }

  const color = input.color || '#6b7280'

  // Validate color format
  const hexColorRegex = /^#[0-9A-Fa-f]{6}$/
  if (!hexColorRegex.test(color)) {
    throw new ValidationError('VALIDATION_ERROR', 'Color must be a valid hex color (e.g., #6b7280)')
  }

  // Create the tag
  const [tag] = await db
    .insert(tags)
    .values({
      name: trimmedName,
      color,
    })
    .returning()

  return tag
}

/**
 * Update an existing tag
 *
 * Validates that:
 * - Tag exists
 * - Update data is valid
 *
 * Note: Authorization should be checked at the action/API layer before calling this.
 */
export async function updateTag(id: TagId, input: UpdateTagInput): Promise<Tag> {
  // Get existing tag
  const existingTag = await db.query.tags.findFirst({
    where: eq(tags.id, id),
  })
  if (!existingTag) {
    throw new NotFoundError('TAG_NOT_FOUND', `Tag with ID ${id} not found`)
  }

  // Basic validation
  if (input.name !== undefined && !input.name.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Tag name cannot be empty')
  }

  // Check for duplicate name (excluding current tag)
  if (input.name !== undefined) {
    const trimmedName = input.name.trim()

    if (trimmedName.length > 50) {
      throw new ValidationError('VALIDATION_ERROR', 'Tag name must not exceed 50 characters')
    }
    const existingTags = await db.query.tags.findMany({
      orderBy: [asc(tags.name)],
    })
    const duplicate = existingTags.find(
      (tag) => tag.id !== id && tag.name.toLowerCase() === trimmedName.toLowerCase()
    )
    if (duplicate) {
      throw new ConflictError('DUPLICATE_NAME', `A tag with name "${trimmedName}" already exists`)
    }
  }

  // Validate color format if provided
  if (input.color !== undefined) {
    const hexColorRegex = /^#[0-9A-Fa-f]{6}$/
    if (!hexColorRegex.test(input.color)) {
      throw new ValidationError(
        'VALIDATION_ERROR',
        'Color must be a valid hex color (e.g., #6b7280)'
      )
    }
  }

  // Build update data
  const updateData: Partial<Tag> = {}
  if (input.name !== undefined) updateData.name = input.name.trim()
  if (input.color !== undefined) updateData.color = input.color

  // Update the tag
  const [updatedTag] = await db.update(tags).set(updateData).where(eq(tags.id, id)).returning()

  if (!updatedTag) {
    throw new NotFoundError('TAG_NOT_FOUND', `Tag with ID ${id} not found`)
  }

  return updatedTag
}

/**
 * Delete a tag
 *
 * Validates that:
 * - Tag exists
 *
 * Note: This will remove the tag from all posts that use it.
 * Authorization should be checked at the action/API layer before calling this.
 */
export async function deleteTag(id: TagId): Promise<void> {
  // Delete the tag (cascade will remove from post_tags junction table)
  // Just delete and check the result - no need for separate existence check
  const result = await db.delete(tags).where(eq(tags.id, id)).returning()
  if (result.length === 0) {
    throw new NotFoundError('TAG_NOT_FOUND', `Tag with ID ${id} not found`)
  }
}

/**
 * Get a tag by ID
 */
export async function getTagById(id: TagId): Promise<Tag> {
  const tag = await db.query.tags.findFirst({
    where: eq(tags.id, id),
  })
  if (!tag) {
    throw new NotFoundError('TAG_NOT_FOUND', `Tag with ID ${id} not found`)
  }

  return tag
}

/**
 * List all tags for the organization
 */
export async function listTags(): Promise<Tag[]> {
  const tagList = await db.query.tags.findMany({
    orderBy: [asc(tags.name)],
  })

  return tagList
}

/**
 * Get all tags used in a specific board
 *
 * This returns only tags that are actually used by posts in the board.
 */
export async function getTagsByBoard(boardId: BoardId): Promise<Tag[]> {
  // Validate board exists
  const board = await db.query.boards.findFirst({
    where: eq(boards.id, boardId),
  })
  if (!board) {
    throw new ValidationError('VALIDATION_ERROR', `Board with ID ${boardId} not found`)
  }

  // Get unique tag IDs used by posts in this board
  const tagResults = await db
    .selectDistinct({ id: tags.id })
    .from(tags)
    .innerJoin(postTags, eq(tags.id, postTags.tagId))
    .innerJoin(posts, eq(postTags.postId, posts.id))
    .where(eq(posts.boardId, boardId))

  if (tagResults.length === 0) {
    return []
  }

  // Fetch full tag details
  const tagIds = tagResults.map((t) => t.id)
  const tagList = await db.query.tags.findMany({
    where: (tags, { inArray }) => inArray(tags.id, tagIds),
    orderBy: [asc(tags.name)],
  })

  return tagList
}

const TAGS_CACHE_KEY = 'public_tags'

/**
 * List all tags (public, no authentication required)
 *
 * Returns tags ordered by name.
 * This method is used for public endpoints like feedback portal filtering.
 * Results are cached per-request since tags rarely change.
 */
export async function listPublicTags(): Promise<Tag[]> {
  // Check request-scoped cache first
  const ctx = tenantStorage.getStore()
  const cached = ctx?.cache.get(TAGS_CACHE_KEY) as Tag[] | undefined
  if (cached) {
    return cached
  }

  try {
    const tagList = await db.query.tags.findMany({
      orderBy: [asc(tags.name)],
    })

    // Cache for subsequent calls within this request
    ctx?.cache.set(TAGS_CACHE_KEY, tagList)

    return tagList
  } catch (error) {
    throw new InternalError(
      'DATABASE_ERROR',
      `Failed to fetch tags: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}
