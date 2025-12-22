/**
 * StatusService - Business logic for status operations
 *
 * This service handles all status-related business logic including:
 * - Status creation and updates
 * - Status deletion with validation
 * - Reordering statuses
 * - Managing default status
 * - Validation and authorization
 */

import { withUnitOfWork, StatusRepository, eq, sql, posts, type UnitOfWork } from '@quackback/db'
import type { StatusId } from '@quackback/ids'
import type { ServiceContext } from '../shared/service-context'
import { ok, err, type Result } from '../shared/result'
import { StatusError } from './status.errors'
import type { Status, CreateStatusInput, UpdateStatusInput } from './status.types'

/**
 * Service class for status domain operations
 */
export class StatusService {
  /**
   * Create a new status
   *
   * Validates that:
   * - User has permission to create statuses (team members only)
   * - Input data is valid
   * - Slug is unique within the organization
   *
   * @param input - Status creation data
   * @param ctx - Service context with user/org information
   * @returns Result containing the created status or an error
   */
  async createStatus(
    input: CreateStatusInput,
    ctx: ServiceContext
  ): Promise<Result<Status, StatusError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const statusRepo = new StatusRepository(uow.db)

      // Authorization check - only team members can create statuses
      if (!['owner', 'admin', 'member'].includes(ctx.memberRole)) {
        return err(StatusError.unauthorized('create statuses'))
      }

      // Validate input
      if (!input.name?.trim()) {
        return err(StatusError.validationError('Name is required'))
      }
      if (input.name.length > 50) {
        return err(StatusError.validationError('Name must be 50 characters or less'))
      }
      if (!input.slug?.trim()) {
        return err(StatusError.validationError('Slug is required'))
      }
      if (input.slug.length > 50) {
        return err(StatusError.validationError('Slug must be 50 characters or less'))
      }
      if (!/^[a-z0-9_]+$/.test(input.slug)) {
        return err(StatusError.validationError('Slug must be lowercase with underscores only'))
      }
      if (!input.color?.trim()) {
        return err(StatusError.validationError('Color is required'))
      }
      if (!/^#[0-9a-fA-F]{6}$/.test(input.color)) {
        return err(StatusError.validationError('Color must be in hex format (e.g., #3b82f6)'))
      }

      // Check if slug already exists
      const existingStatus = await statusRepo.findBySlug(input.slug)
      if (existingStatus) {
        return err(StatusError.duplicateSlug(input.slug))
      }

      // Create the status
      const status = await statusRepo.create({
        name: input.name.trim(),
        slug: input.slug.trim(),
        color: input.color,
        category: input.category,
        position: input.position ?? 0,
        showOnRoadmap: input.showOnRoadmap ?? false,
        isDefault: input.isDefault ?? false,
      })

      // If this is marked as default, ensure only one default exists
      if (input.isDefault) {
        await statusRepo.setDefault(status.id)
      }

      return ok(status)
    })
  }

  /**
   * Update an existing status
   *
   * Validates that:
   * - Status exists and belongs to the organization
   * - User has permission to update statuses
   * - Update data is valid
   *
   * @param id - Status ID to update
   * @param input - Update data
   * @param ctx - Service context with user/org information
   * @returns Result containing the updated status or an error
   */
  async updateStatus(
    id: StatusId,
    input: UpdateStatusInput,
    ctx: ServiceContext
  ): Promise<Result<Status, StatusError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const statusRepo = new StatusRepository(uow.db)

      // Authorization check - only team members can update statuses
      if (!['owner', 'admin', 'member'].includes(ctx.memberRole)) {
        return err(StatusError.unauthorized('update statuses'))
      }

      // Get existing status
      const existingStatus = await statusRepo.findById(id)
      if (!existingStatus) {
        return err(StatusError.notFound(id))
      }

      // Validate input
      if (input.name !== undefined) {
        if (!input.name.trim()) {
          return err(StatusError.validationError('Name cannot be empty'))
        }
        if (input.name.length > 50) {
          return err(StatusError.validationError('Name must be 50 characters or less'))
        }
      }
      if (input.color !== undefined) {
        if (!input.color.trim()) {
          return err(StatusError.validationError('Color cannot be empty'))
        }
        if (!/^#[0-9a-fA-F]{6}$/.test(input.color)) {
          return err(StatusError.validationError('Color must be in hex format (e.g., #3b82f6)'))
        }
      }

      // If setting as default, use the special function
      if (input.isDefault === true) {
        await statusRepo.setDefault(id)
      }

      // Build update data
      const updateData: Partial<Status> = {}
      if (input.name !== undefined) updateData.name = input.name.trim()
      if (input.color !== undefined) updateData.color = input.color
      if (input.showOnRoadmap !== undefined) updateData.showOnRoadmap = input.showOnRoadmap
      if (input.isDefault === false) updateData.isDefault = false

      // Update the status
      const updatedStatus = await statusRepo.update(id, updateData)
      if (!updatedStatus) {
        return err(StatusError.notFound(id))
      }

      return ok(updatedStatus)
    })
  }

  /**
   * Delete a status
   *
   * Validates that:
   * - Status exists and belongs to the organization
   * - User has permission to delete statuses
   * - Status is not the default status
   * - No posts are using this status
   *
   * @param id - Status ID to delete
   * @param ctx - Service context with user/org information
   * @returns Result containing void or an error
   */
  async deleteStatus(id: StatusId, ctx: ServiceContext): Promise<Result<void, StatusError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const statusRepo = new StatusRepository(uow.db)

      // Authorization check - only team members can delete statuses
      if (!['owner', 'admin', 'member'].includes(ctx.memberRole)) {
        return err(StatusError.unauthorized('delete statuses'))
      }

      // Get existing status
      const existingStatus = await statusRepo.findById(id)
      if (!existingStatus) {
        return err(StatusError.notFound(id))
      }

      // Check if status is the default
      if (existingStatus.isDefault) {
        return err(StatusError.cannotDeleteDefault())
      }

      // Check if any posts are using this status
      const result = await uow.db
        .select({ count: sql<number>`count(*)` })
        .from(posts)
        .where(eq(posts.statusId, id))

      const usageCount = Number(result[0].count)
      if (usageCount > 0) {
        return err(StatusError.cannotDeleteInUse(usageCount))
      }

      // Delete the status
      await statusRepo.delete(id)

      return ok(undefined)
    })
  }

  /**
   * Get a status by ID
   *
   * @param id - Status ID to fetch
   * @param ctx - Service context with user/org information
   * @returns Result containing the status or an error
   */
  async getStatusById(id: StatusId, _ctx: ServiceContext): Promise<Result<Status, StatusError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const statusRepo = new StatusRepository(uow.db)

      const status = await statusRepo.findById(id)
      if (!status) {
        return err(StatusError.notFound(id))
      }

      return ok(status)
    })
  }

  /**
   * List all statuses for the organization
   *
   * Returns statuses ordered by category (active, complete, closed) and position.
   *
   * @param ctx - Service context with user/org information
   * @returns Result containing array of statuses or an error
   */
  async listStatuses(_ctx: ServiceContext): Promise<Result<Status[], StatusError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const statusRepo = new StatusRepository(uow.db)

      const statuses = await statusRepo.findAll()

      return ok(statuses)
    })
  }

  /**
   * Reorder statuses within a category
   *
   * Takes an array of status IDs in the desired order and updates their positions.
   *
   * Validates that:
   * - User has permission to reorder statuses (team members only)
   * - All status IDs are provided
   *
   * @param ids - Array of status IDs in desired order
   * @param ctx - Service context with user/org information
   * @returns Result containing void or an error
   */
  async reorderStatuses(ids: StatusId[], ctx: ServiceContext): Promise<Result<void, StatusError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const statusRepo = new StatusRepository(uow.db)

      // Authorization check - only team members can reorder statuses
      if (!['owner', 'admin', 'member'].includes(ctx.memberRole)) {
        return err(StatusError.unauthorized('reorder statuses'))
      }

      // Validate input
      if (!ids || ids.length === 0) {
        return err(StatusError.validationError('Status IDs are required'))
      }

      // Reorder the statuses
      await statusRepo.reorder(ids)

      return ok(undefined)
    })
  }

  /**
   * Set a status as the default for new posts
   *
   * This will unset any other default status in the organization.
   *
   * Validates that:
   * - Status exists and belongs to the organization
   * - User has permission to set default status (team members only)
   *
   * @param id - Status ID to set as default
   * @param ctx - Service context with user/org information
   * @returns Result containing the updated status or an error
   */
  async setDefaultStatus(id: StatusId, ctx: ServiceContext): Promise<Result<Status, StatusError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const statusRepo = new StatusRepository(uow.db)

      // Authorization check - only team members can set default status
      if (!['owner', 'admin', 'member'].includes(ctx.memberRole)) {
        return err(StatusError.unauthorized('set default status'))
      }

      // Get existing status to verify it exists
      const existingStatus = await statusRepo.findById(id)
      if (!existingStatus) {
        return err(StatusError.notFound(id))
      }

      // Set as default
      await statusRepo.setDefault(id)

      // Fetch and return the updated status
      const updatedStatus = await statusRepo.findById(id)
      if (!updatedStatus) {
        return err(StatusError.notFound(id))
      }

      return ok(updatedStatus)
    })
  }

  /**
   * Get the default status for new posts
   *
   * Returns null if no default status is set for the organization.
   *
   * @param ctx - Service context with user/org information
   * @returns Result containing the default status, null if not found, or an error
   */
  async getDefaultStatus(_ctx: ServiceContext): Promise<Result<Status | null, StatusError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const statusRepo = new StatusRepository(uow.db)

      const defaultStatus = await statusRepo.findDefault()

      return ok(defaultStatus)
    })
  }

  /**
   * Get a status by slug
   *
   * This method is useful for public endpoints that reference statuses by slug.
   *
   * @param slug - Status slug to find
   * @param ctx - Service context with user/org information
   * @returns Result containing the status or an error
   */
  async getStatusBySlug(slug: string, _ctx: ServiceContext): Promise<Result<Status, StatusError>> {
    return withUnitOfWork(async (uow: UnitOfWork) => {
      const statusRepo = new StatusRepository(uow.db)

      const status = await statusRepo.findBySlug(slug)
      if (!status) {
        return err(StatusError.notFound(slug))
      }

      return ok(status)
    })
  }

  /**
   * Seed default statuses for a new organization
   *
   * This method is called during initial setup to initialize
   * the default set of statuses (Open, Under Review, Planned, In Progress, Complete, Closed).
   * This is a public method that doesn't require ServiceContext since it's used
   * during initial setup.
   *
   * @returns Result containing the created statuses or an error
   */
  async seedDefaultStatuses(): Promise<Result<Status[], StatusError>> {
    try {
      const { db, postStatuses, DEFAULT_STATUSES } = await import('@quackback/db')

      const inserted = await db.insert(postStatuses).values(DEFAULT_STATUSES).returning()

      return ok(inserted)
    } catch (error) {
      return err(
        StatusError.validationError(
          `Failed to seed statuses: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * List all statuses (public, no authentication required)
   *
   * Returns statuses ordered by category (active, complete, closed) and position.
   * This method is used for public endpoints like roadmap and post detail pages.
   *
   * @returns Result containing array of statuses or an error
   */
  async listPublicStatuses(): Promise<Result<Status[], StatusError>> {
    try {
      const { db, postStatuses, asc } = await import('@quackback/db')

      const statuses = await db.query.postStatuses.findMany({
        orderBy: [asc(postStatuses.category), asc(postStatuses.position)],
      })

      return ok(statuses)
    } catch (error) {
      return err(
        StatusError.validationError(
          `Failed to fetch statuses: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }
}

/**
 * Singleton instance of StatusService
 * Export as default for easy importing
 */
export const statusService = new StatusService()
