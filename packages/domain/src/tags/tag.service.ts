/**
 * TagService - Business logic for tag operations
 *
 * This service handles all tag-related business logic including:
 * - Tag creation and updates
 * - Tag deletion
 * - Tag retrieval and listing
 * - Validation and authorization
 */

import {
  withUnitOfWork,
  TagRepository,
  BoardRepository,
  type Tag,
  type UnitOfWork,
} from '@quackback/db'
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
    return withUnitOfWork(async (uow: UnitOfWork) => {
      // Authorization check - only team members (owner, admin, member) can create tags
      // Portal users don't have member records, so memberRole would be undefined
      if (!ctx.memberRole || !['owner', 'admin', 'member'].includes(ctx.memberRole)) {
        return err(TagError.unauthorized('create tags'))
      }

      const tagRepo = new TagRepository(uow.db)

      // Note: Basic validation (name required/length, color format) handled by Zod in action layer

      const trimmedName = input.name.trim()

      // Check for duplicate name in the organization
      const existingTags = await tagRepo.findAll()
      const duplicate = existingTags.find(
        (tag) => tag.name.toLowerCase() === trimmedName.toLowerCase()
      )
      if (duplicate) {
        return err(TagError.duplicateName(trimmedName))
      }

      const color = input.color || '#6b7280'

      // Create the tag
      const tag = await tagRepo.create({
        name: trimmedName,
        color,
      })

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
    return withUnitOfWork(async (uow: UnitOfWork) => {
      // Authorization check - only team members (owner, admin, member) can update tags
      if (!['owner', 'admin', 'member'].includes(ctx.memberRole)) {
        return err(TagError.unauthorized('update tags'))
      }

      const tagRepo = new TagRepository(uow.db)

      // Get existing tag
      const existingTag = await tagRepo.findById(id)
      if (!existingTag) {
        return err(TagError.notFound(id))
      }

      // Note: Basic validation (name empty/length, color format) handled by Zod in action layer

      // Check for duplicate name (excluding current tag)
      if (input.name !== undefined) {
        const trimmedName = input.name.trim()
        const existingTags = await tagRepo.findAll()
        const duplicate = existingTags.find(
          (tag) => tag.id !== id && tag.name.toLowerCase() === trimmedName.toLowerCase()
        )
        if (duplicate) {
          return err(TagError.duplicateName(trimmedName))
        }
      }

      // Build update data
      const updateData: Partial<Tag> = {}
      if (input.name !== undefined) updateData.name = input.name.trim()
      if (input.color !== undefined) updateData.color = input.color

      // Update the tag
      const updatedTag = await tagRepo.update(id, updateData)
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
    return withUnitOfWork(async (uow: UnitOfWork) => {
      // Authorization check - only team members (owner, admin, member) can delete tags
      if (!['owner', 'admin', 'member'].includes(ctx.memberRole)) {
        return err(TagError.unauthorized('delete tags'))
      }

      const tagRepo = new TagRepository(uow.db)

      // Verify tag exists
      const existingTag = await tagRepo.findById(id)
      if (!existingTag) {
        return err(TagError.notFound(id))
      }

      // Delete the tag (cascade will remove from post_tags junction table)
      const deleted = await tagRepo.delete(id)
      if (!deleted) {
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
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const tagRepo = new TagRepository(uow.db)

      const tag = await tagRepo.findById(id)
      if (!tag) {
        return err(TagError.notFound(id))
      }

      return ok(tag)
    })
  }

  /**
   * List all tags for the organization
   *
   * @param ctx - Service context with user/org information
   * @returns Result containing array of tags or an error
   */
  async listTags(_ctx: ServiceContext): Promise<Result<Tag[], TagError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const tagRepo = new TagRepository(uow.db)

      const tags = await tagRepo.findAll()

      return ok(tags)
    })
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
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const boardRepo = new BoardRepository(uow.db)
      const tagRepo = new TagRepository(uow.db)

      // Validate board exists and belongs to this organization
      const board = await boardRepo.findById(boardId)
      if (!board) {
        return err(TagError.validationError(`Board with ID ${boardId} not found`))
      }

      // Get tags used in this board
      const tags = await tagRepo.findByBoardId(boardId)

      return ok(tags)
    })
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
