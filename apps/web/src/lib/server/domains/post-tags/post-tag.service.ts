/**
 * PostTag Service - Business logic for tag operations
 *
 * This module handles all tag-related business logic including:
 * - PostTag creation and updates
 * - PostTag deletion
 * - PostTag retrieval and listing
 * - Validation
 *
 * Note: Authorization is handled at the action/API layer, not in services.
 */

import {
  db,
  eq,
  and,
  isNull,
  asc,
  type PostTag,
  postTags,
  boards,
  postTagAssignments,
  posts,
} from '@/lib/server/db'
import type { PostTagId, BoardId } from '@quackback/ids'
import { NotFoundError, ValidationError, ConflictError, InternalError } from '@/lib/shared/errors'
import type { CreateTagInput, UpdateTagInput } from './post-tag.types'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'tags' })

/**
 * Create a new tag
 *
 * Validates that:
 * - PostTag name is valid and unique within the organization
 * - Color is valid
 *
 * Note: Authorization should be checked at the action/API layer before calling this.
 */
export async function createPostTag(input: CreateTagInput): Promise<PostTag> {
  log.debug({ name: input.name }, 'create tag')
  // Basic validation
  if (!input.name || !input.name.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'PostTag name is required')
  }

  const trimmedName = input.name.trim()

  if (trimmedName.length > 50) {
    throw new ValidationError('VALIDATION_ERROR', 'PostTag name must not exceed 50 characters')
  }

  // Check for duplicate name in the organization
  const existingTags = await db.query.postTags.findMany({
    orderBy: [asc(postTags.name)],
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
    .insert(postTags)
    .values({
      name: trimmedName,
      color,
      description: input.description?.trim() || null,
    })
    .returning()

  return tag
}

/**
 * Update an existing tag
 *
 * Validates that:
 * - PostTag exists
 * - Update data is valid
 *
 * Note: Authorization should be checked at the action/API layer before calling this.
 */
export async function updatePostTag(id: PostTagId, input: UpdateTagInput): Promise<PostTag> {
  log.debug({ tag_id: id }, 'update tag')
  // Get existing tag
  const existingTag = await db.query.postTags.findFirst({
    where: eq(postTags.id, id),
  })
  if (!existingTag) {
    throw new NotFoundError('TAG_NOT_FOUND', `PostTag with ID ${id} not found`)
  }

  // Basic validation
  if (input.name !== undefined && !input.name.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'PostTag name cannot be empty')
  }

  // Check for duplicate name (excluding current tag)
  if (input.name !== undefined) {
    const trimmedName = input.name.trim()

    if (trimmedName.length > 50) {
      throw new ValidationError('VALIDATION_ERROR', 'PostTag name must not exceed 50 characters')
    }
    const existingTags = await db.query.postTags.findMany({
      orderBy: [asc(postTags.name)],
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
  const updateData: Partial<PostTag> = {}
  if (input.name !== undefined) updateData.name = input.name.trim()
  if (input.color !== undefined) updateData.color = input.color
  if (input.description !== undefined) updateData.description = input.description?.trim() || null

  // Update the tag
  const [updatedTag] = await db
    .update(postTags)
    .set(updateData)
    .where(eq(postTags.id, id))
    .returning()

  if (!updatedTag) {
    throw new NotFoundError('TAG_NOT_FOUND', `PostTag with ID ${id} not found`)
  }

  return updatedTag
}

/**
 * Soft delete a tag
 *
 * Validates that:
 * - PostTag exists and is not already deleted
 *
 * Note: Sets deletedAt timestamp instead of removing the row.
 * Authorization should be checked at the action/API layer before calling this.
 */
export async function deletePostTag(id: PostTagId): Promise<void> {
  log.debug({ tag_id: id }, 'delete tag')
  // Soft delete the tag by setting deletedAt
  const result = await db
    .update(postTags)
    .set({ deletedAt: new Date() })
    .where(and(eq(postTags.id, id), isNull(postTags.deletedAt)))
    .returning()

  if (result.length === 0) {
    throw new NotFoundError('TAG_NOT_FOUND', `PostTag with ID ${id} not found`)
  }
}

/**
 * Get a tag by ID
 */
export async function getTagById(id: PostTagId): Promise<PostTag> {
  log.debug({ tag_id: id }, 'get tag by id')
  const tag = await db.query.postTags.findFirst({
    where: eq(postTags.id, id),
  })
  if (!tag) {
    throw new NotFoundError('TAG_NOT_FOUND', `PostTag with ID ${id} not found`)
  }

  return tag
}

/**
 * List all tags for the organization (excludes soft-deleted)
 */
export async function listPostTags(): Promise<PostTag[]> {
  log.debug('list tags')
  const tagList = await db.query.postTags.findMany({
    where: isNull(postTags.deletedAt),
    orderBy: [asc(postTags.name)],
  })

  return tagList
}

/**
 * Get all tags used in a specific board
 *
 * This returns only tags that are actually used by posts in the board.
 */
export async function getPostTagsByBoard(boardId: BoardId): Promise<PostTag[]> {
  log.debug({ board_id: boardId }, 'get tags by board')
  // Validate board exists
  const board = await db.query.boards.findFirst({
    where: eq(boards.id, boardId),
  })
  if (!board) {
    throw new ValidationError('VALIDATION_ERROR', `Board with ID ${boardId} not found`)
  }

  // Get unique tag IDs used by non-deleted posts in this board
  const tagResults = await db
    .selectDistinct({ id: postTags.id })
    .from(postTags)
    .innerJoin(postTagAssignments, eq(postTags.id, postTagAssignments.tagId))
    .innerJoin(posts, eq(postTagAssignments.postId, posts.id))
    .where(and(eq(posts.boardId, boardId), isNull(posts.deletedAt)))

  if (tagResults.length === 0) {
    return []
  }

  // Fetch full tag details
  const tagIds = tagResults.map((t) => t.id)
  const tagList = await db.query.postTags.findMany({
    where: (tags, { inArray }) => inArray(postTags.id, tagIds),
    orderBy: [asc(postTags.name)],
  })

  return tagList
}

/**
 * List all tags (public, no authentication required)
 *
 * Returns tags ordered by name.
 * This method is used for public endpoints like feedback portal filtering.
 */
export async function listPublicPostTags(): Promise<PostTag[]> {
  log.debug('list public tags')
  try {
    return await db.query.postTags.findMany({
      where: isNull(postTags.deletedAt),
      orderBy: [asc(postTags.name)],
    })
  } catch (error) {
    log.error({ err: error }, 'list public tags failed')
    throw new InternalError(
      'DATABASE_ERROR',
      `Failed to fetch tags: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}
