/**
 * StatusService - Business logic for status operations
 *
 * This service handles all status-related business logic including:
 * - Status creation and updates
 * - Status deletion with validation
 * - Reordering statuses
 * - Managing default status
 * - Validation
 */

import { db, eq, sql, posts, postStatuses, asc } from '@quackback/db'
import type { StatusId } from '@quackback/ids'
import {
  NotFoundError,
  ValidationError,
  ConflictError,
  ForbiddenError,
  InternalError,
} from '@/lib/shared/errors'
import type { Status, CreateStatusInput, UpdateStatusInput } from './status.types'

/**
 * Create a new status
 */
export async function createStatus(input: CreateStatusInput): Promise<Status> {
  return db.transaction(async (tx) => {
    // Validate input
    if (!input.name?.trim()) {
      throw new ValidationError('VALIDATION_ERROR', 'Name is required')
    }
    if (input.name.length > 50) {
      throw new ValidationError('VALIDATION_ERROR', 'Name must be 50 characters or less')
    }
    if (!input.slug?.trim()) {
      throw new ValidationError('VALIDATION_ERROR', 'Slug is required')
    }
    if (input.slug.length > 50) {
      throw new ValidationError('VALIDATION_ERROR', 'Slug must be 50 characters or less')
    }
    if (!/^[a-z0-9_]+$/.test(input.slug)) {
      throw new ValidationError('VALIDATION_ERROR', 'Slug must be lowercase with underscores only')
    }
    if (!input.color?.trim()) {
      throw new ValidationError('VALIDATION_ERROR', 'Color is required')
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(input.color)) {
      throw new ValidationError('VALIDATION_ERROR', 'Color must be in hex format (e.g., #3b82f6)')
    }

    // Check if slug already exists
    const existingStatus = await tx.query.postStatuses.findFirst({
      where: eq(postStatuses.slug, input.slug),
    })
    if (existingStatus) {
      throw new ConflictError('DUPLICATE_SLUG', `A status with slug '${input.slug}' already exists`)
    }

    // Create the status
    const [status] = await tx
      .insert(postStatuses)
      .values({
        name: input.name.trim(),
        slug: input.slug.trim(),
        color: input.color,
        category: input.category,
        position: input.position ?? 0,
        showOnRoadmap: input.showOnRoadmap ?? false,
        isDefault: input.isDefault ?? false,
      })
      .returning()

    // If this is marked as default, ensure only one default exists
    if (input.isDefault) {
      // First, unset all defaults
      await tx.update(postStatuses).set({ isDefault: false })
      // Then set the new default
      await tx.update(postStatuses).set({ isDefault: true }).where(eq(postStatuses.id, status.id))
    }

    return status
  })
}

/**
 * Update an existing status
 */
export async function updateStatus(id: StatusId, input: UpdateStatusInput): Promise<Status> {
  return db.transaction(async (tx) => {
    // Get existing status
    const existingStatus = await tx.query.postStatuses.findFirst({
      where: eq(postStatuses.id, id),
    })
    if (!existingStatus) {
      throw new NotFoundError('STATUS_NOT_FOUND', `Status with ID ${id} not found`)
    }

    // Validate input
    if (input.name !== undefined) {
      if (!input.name.trim()) {
        throw new ValidationError('VALIDATION_ERROR', 'Name cannot be empty')
      }
      if (input.name.length > 50) {
        throw new ValidationError('VALIDATION_ERROR', 'Name must be 50 characters or less')
      }
    }
    if (input.color !== undefined) {
      if (!input.color.trim()) {
        throw new ValidationError('VALIDATION_ERROR', 'Color cannot be empty')
      }
      if (!/^#[0-9a-fA-F]{6}$/.test(input.color)) {
        throw new ValidationError('VALIDATION_ERROR', 'Color must be in hex format (e.g., #3b82f6)')
      }
    }

    // If setting as default, use the setDefault pattern
    if (input.isDefault === true) {
      // First, unset all defaults
      await tx.update(postStatuses).set({ isDefault: false })
      // Then set the new default
      await tx.update(postStatuses).set({ isDefault: true }).where(eq(postStatuses.id, id))
    }

    // Build update data
    const updateData: Partial<Status> = {}
    if (input.name !== undefined) updateData.name = input.name.trim()
    if (input.color !== undefined) updateData.color = input.color
    if (input.showOnRoadmap !== undefined) updateData.showOnRoadmap = input.showOnRoadmap
    if (input.isDefault === false) updateData.isDefault = false

    // Update the status
    const [updatedStatus] = await tx
      .update(postStatuses)
      .set(updateData)
      .where(eq(postStatuses.id, id))
      .returning()

    if (!updatedStatus) {
      throw new NotFoundError('STATUS_NOT_FOUND', `Status with ID ${id} not found`)
    }

    return updatedStatus
  })
}

/**
 * Delete a status
 */
export async function deleteStatus(id: StatusId): Promise<void> {
  return db.transaction(async (tx) => {
    // Get existing status
    const existingStatus = await tx.query.postStatuses.findFirst({
      where: eq(postStatuses.id, id),
    })
    if (!existingStatus) {
      throw new NotFoundError('STATUS_NOT_FOUND', `Status with ID ${id} not found`)
    }

    // Check if status is the default
    if (existingStatus.isDefault) {
      throw new ForbiddenError(
        'CANNOT_DELETE_DEFAULT',
        'Cannot delete the default status. Set another status as default first.'
      )
    }

    // Check if any posts are using this status
    const result = await tx
      .select({ count: sql<number>`count(*)` })
      .from(posts)
      .where(eq(posts.statusId, id))

    const usageCount = Number(result[0].count)
    if (usageCount > 0) {
      throw new ForbiddenError(
        'CANNOT_DELETE_IN_USE',
        `Cannot delete status. ${usageCount} post(s) are using this status. Reassign them first.`
      )
    }

    // Delete the status
    const deleteResult = await tx.delete(postStatuses).where(eq(postStatuses.id, id)).returning()
    if (deleteResult.length === 0) {
      throw new NotFoundError('STATUS_NOT_FOUND', `Status with ID ${id} not found`)
    }
  })
}

/**
 * Get a status by ID
 */
export async function getStatusById(id: StatusId): Promise<Status> {
  const status = await db.query.postStatuses.findFirst({
    where: eq(postStatuses.id, id),
  })
  if (!status) {
    throw new NotFoundError('STATUS_NOT_FOUND', `Status with ID ${id} not found`)
  }

  return status
}

/**
 * List all statuses for the organization
 */
export async function listStatuses(): Promise<Status[]> {
  const statuses = await db.query.postStatuses.findMany({
    orderBy: [
      // Order by category (active, complete, closed) then position
      sql`CASE
        WHEN ${postStatuses.category} = 'active' THEN 0
        WHEN ${postStatuses.category} = 'complete' THEN 1
        WHEN ${postStatuses.category} = 'closed' THEN 2
      END`,
      asc(postStatuses.position),
    ],
  })

  return statuses
}

/**
 * Reorder statuses within a category
 */
export async function reorderStatuses(ids: StatusId[]): Promise<void> {
  return db.transaction(async (tx) => {
    // Validate input
    if (!ids || ids.length === 0) {
      throw new ValidationError('VALIDATION_ERROR', 'Status IDs are required')
    }

    // Reorder the statuses by updating their positions
    await Promise.all(
      ids.map((id, index) =>
        tx.update(postStatuses).set({ position: index }).where(eq(postStatuses.id, id))
      )
    )
  })
}

/**
 * Set a status as the default for new posts
 */
export async function setDefaultStatus(id: StatusId): Promise<Status> {
  return db.transaction(async (tx) => {
    // Get existing status to verify it exists
    const existingStatus = await tx.query.postStatuses.findFirst({
      where: eq(postStatuses.id, id),
    })
    if (!existingStatus) {
      throw new NotFoundError('STATUS_NOT_FOUND', `Status with ID ${id} not found`)
    }

    // Set as default (unset all others first, then set this one)
    await tx.update(postStatuses).set({ isDefault: false })
    await tx.update(postStatuses).set({ isDefault: true }).where(eq(postStatuses.id, id))

    // Fetch and return the updated status
    const updatedStatus = await tx.query.postStatuses.findFirst({
      where: eq(postStatuses.id, id),
    })
    if (!updatedStatus) {
      throw new NotFoundError('STATUS_NOT_FOUND', `Status with ID ${id} not found`)
    }

    return updatedStatus
  })
}

/**
 * Get the default status for new posts
 */
export async function getDefaultStatus(): Promise<Status | null> {
  const defaultStatus = await db.query.postStatuses.findFirst({
    where: eq(postStatuses.isDefault, true),
  })

  return defaultStatus ?? null
}

/**
 * Get a status by slug
 */
export async function getStatusBySlug(slug: string): Promise<Status> {
  const status = await db.query.postStatuses.findFirst({
    where: eq(postStatuses.slug, slug),
  })
  if (!status) {
    throw new NotFoundError('STATUS_NOT_FOUND', `Status with slug '${slug}' not found`)
  }

  return status
}

/**
 * List all statuses (public, no authentication required)
 */
export async function listPublicStatuses(): Promise<Status[]> {
  try {
    const { db, postStatuses, asc } = await import('@quackback/db')

    const statuses = await db.query.postStatuses.findMany({
      orderBy: [asc(postStatuses.category), asc(postStatuses.position)],
    })

    return statuses
  } catch (error) {
    throw new InternalError(
      'DATABASE_ERROR',
      `Failed to fetch statuses: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}
