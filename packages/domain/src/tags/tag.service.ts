/**
 * TagService - Business logic for tag operations
 *
 * This service handles all tag-related business logic including:
 * - Tag creation and updates
 * - Tag deletion
 * - Tag retrieval and listing
 * - Validation and authorization
 */

import { db, eq, asc, type Tag, tags, boards, postTags, posts } from '@quackback/db'
import type { TagId, BoardId } from '@quackback/ids'
import type { ServiceContext } from '../shared/service-context'
import { ok, err, type Result } from '../shared/result'
import { TagError } from './tag.errors'
import type { CreateTagInput, UpdateTagInput } from './tag.types'

/**
 * Service class for tag domain operations
 */
export class TagService {
  /**
   * Create a new tag
   *
   * Validates that:
   * - User has permission to create tags (team members only)
   * - Tag name is valid and unique within the organization
   * - Color is valid
   *
   * @param input - Tag creation data
   * @param ctx - Service context with user/org information
   * @returns Result containing the created tag or an error
   */
  async createTag(input: CreateTagInput, ctx: ServiceContext): Promise<Result<Tag, TagError>> {
    return db.transaction(async (tx) => {
      // Authorization check - only team members (owner, admin, member) can create tags
      // Portal users don't have member records, so memberRole would be undefined
      if (!ctx.memberRole || !['owner', 'admin', 'member'].includes(ctx.memberRole)) {
        return err(TagError.unauthorized('create tags'))
      }

      // Basic validation (also done at action layer, but enforced here for direct service calls)
      if (!input.name || !input.name.trim()) {
        return err(TagError.validationError('Tag name is required'))
      }

      const trimmedName = input.name.trim()

      if (trimmedName.length > 50) {
        return err(TagError.validationError('Tag name must not exceed 50 characters'))
      }

      // Check for duplicate name in the organization
      const existingTags = await tx.query.tags.findMany({
        orderBy: [asc(tags.name)],
      })
      const duplicate = existingTags.find(
        (tag) => tag.name.toLowerCase() === trimmedName.toLowerCase()
      )
      if (duplicate) {
        return err(TagError.duplicateName(trimmedName))
      }

      const color = input.color || '#6b7280'

      // Validate color format
      const hexColorRegex = /^#[0-9A-Fa-f]{6}$/
      if (!hexColorRegex.test(color)) {
        return err(TagError.validationError('Color must be a valid hex color (e.g., #6b7280)'))
      }

      // Create the tag
      const [tag] = await tx
        .insert(tags)
        .values({
          name: trimmedName,
          color,
        })
        .returning()

      return ok(tag)
    })
  }

  /**
   * Update an existing tag
   *
   * Validates that:
   * - Tag exists and belongs to the organization
   * - User has permission to update tags (team members only)
   * - Update data is valid
   *
   * @param id - Tag ID to update
   * @param input - Update data
   * @param ctx - Service context with user/org information
   * @returns Result containing the updated tag or an error
   */
  async updateTag(
    id: TagId,
    input: UpdateTagInput,
    ctx: ServiceContext
  ): Promise<Result<Tag, TagError>> {
    return db.transaction(async (tx) => {
      // Authorization check - only team members (owner, admin, member) can update tags
      if (!['owner', 'admin', 'member'].includes(ctx.memberRole)) {
        return err(TagError.unauthorized('update tags'))
      }

      // Get existing tag
      const existingTag = await tx.query.tags.findFirst({
        where: eq(tags.id, id),
      })
      if (!existingTag) {
        return err(TagError.notFound(id))
      }

      // Basic validation (also done at action layer, but enforced here for direct service calls)
      if (input.name !== undefined && !input.name.trim()) {
        return err(TagError.validationError('Tag name cannot be empty'))
      }

      // Check for duplicate name (excluding current tag)
      if (input.name !== undefined) {
        const trimmedName = input.name.trim()

        if (trimmedName.length > 50) {
          return err(TagError.validationError('Tag name must not exceed 50 characters'))
        }
        const existingTags = await tx.query.tags.findMany({
          orderBy: [asc(tags.name)],
        })
        const duplicate = existingTags.find(
          (tag) => tag.id !== id && tag.name.toLowerCase() === trimmedName.toLowerCase()
        )
        if (duplicate) {
          return err(TagError.duplicateName(trimmedName))
        }
      }

      // Validate color format if provided
      if (input.color !== undefined) {
        const hexColorRegex = /^#[0-9A-Fa-f]{6}$/
        if (!hexColorRegex.test(input.color)) {
          return err(TagError.validationError('Color must be a valid hex color (e.g., #6b7280)'))
        }
      }

      // Build update data
      const updateData: Partial<Tag> = {}
      if (input.name !== undefined) updateData.name = input.name.trim()
      if (input.color !== undefined) updateData.color = input.color

      // Update the tag
      const [updatedTag] = await tx.update(tags).set(updateData).where(eq(tags.id, id)).returning()

      if (!updatedTag) {
        return err(TagError.notFound(id))
      }

      return ok(updatedTag)
    })
  }

  /**
   * Delete a tag
   *
   * Validates that:
   * - Tag exists and belongs to the organization
   * - User has permission to delete tags (team members only)
   *
   * Note: This will remove the tag from all posts that use it.
   *
   * @param id - Tag ID to delete
   * @param ctx - Service context with user/org information
   * @returns Result containing void or an error
   */
  async deleteTag(id: TagId, ctx: ServiceContext): Promise<Result<void, TagError>> {
    return db.transaction(async (tx) => {
      // Authorization check - only team members (owner, admin, member) can delete tags
      if (!['owner', 'admin', 'member'].includes(ctx.memberRole)) {
        return err(TagError.unauthorized('delete tags'))
      }

      // Verify tag exists
      const existingTag = await tx.query.tags.findFirst({
        where: eq(tags.id, id),
      })
      if (!existingTag) {
        return err(TagError.notFound(id))
      }

      // Delete the tag (cascade will remove from post_tags junction table)
      const result = await tx.delete(tags).where(eq(tags.id, id)).returning()
      if (result.length === 0) {
        return err(TagError.notFound(id))
      }

      return ok(undefined)
    })
  }

  /**
   * Get a tag by ID
   *
   * @param id - Tag ID to fetch
   * @param ctx - Service context with user/org information
   * @returns Result containing the tag or an error
   */
  async getTagById(id: TagId, _ctx: ServiceContext): Promise<Result<Tag, TagError>> {
    const tag = await db.query.tags.findFirst({
      where: eq(tags.id, id),
    })
    if (!tag) {
      return err(TagError.notFound(id))
    }

    return ok(tag)
  }

  /**
   * List all tags for the organization
   *
   * @param ctx - Service context with user/org information
   * @returns Result containing array of tags or an error
   */
  async listTags(_ctx: ServiceContext): Promise<Result<Tag[], TagError>> {
    const tagList = await db.query.tags.findMany({
      orderBy: [asc(tags.name)],
    })

    return ok(tagList)
  }

  /**
   * Get all tags used in a specific board
   *
   * This returns only tags that are actually used by posts in the board.
   *
   * @param boardId - Board ID to fetch tags for
   * @param ctx - Service context with user/org information
   * @returns Result containing array of tags or an error
   */
  async getTagsByBoard(boardId: BoardId, _ctx: ServiceContext): Promise<Result<Tag[], TagError>> {
    // Validate board exists
    const board = await db.query.boards.findFirst({
      where: eq(boards.id, boardId),
    })
    if (!board) {
      return err(TagError.validationError(`Board with ID ${boardId} not found`))
    }

    // Get unique tag IDs used by posts in this board
    const tagResults = await db
      .selectDistinct({ id: tags.id })
      .from(tags)
      .innerJoin(postTags, eq(tags.id, postTags.tagId))
      .innerJoin(posts, eq(postTags.postId, posts.id))
      .where(eq(posts.boardId, boardId))

    if (tagResults.length === 0) {
      return ok([])
    }

    // Fetch full tag details
    const tagIds = tagResults.map((t) => t.id)
    const tagList = await db.query.tags.findMany({
      where: (tags, { inArray }) => inArray(tags.id, tagIds),
      orderBy: [asc(tags.name)],
    })

    return ok(tagList)
  }

  /**
   * List all tags (public, no authentication required)
   *
   * Returns tags ordered by name.
   * This method is used for public endpoints like feedback portal filtering.
   *
   * @returns Result containing array of tags or an error
   */
  async listPublicTags(): Promise<Result<Tag[], TagError>> {
    try {
      const { db, tags, asc } = await import('@quackback/db')

      const tagList = await db.query.tags.findMany({
        orderBy: [asc(tags.name)],
      })

      return ok(tagList)
    } catch (error) {
      return err(
        TagError.validationError(
          `Failed to fetch tags: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }
}

/**
 * Singleton instance of TagService
 * Export as default for easy importing
 */
export const tagService = new TagService()
