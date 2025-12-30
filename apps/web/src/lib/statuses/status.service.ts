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
import { ok, err, type Result } from '@/lib/shared'
import { StatusError } from './status.errors'
import type { Status, CreateStatusInput, UpdateStatusInput } from './status.types'

/**
 * Create a new status
 *
 * Validates that:
 * - Input data is valid
 * - Slug is unique within the organization
 *
 * @param input - Status creation data
 * @returns Result containing the created status or an error
 */
export async function createStatus(input: CreateStatusInput): Promise<Result<Status, StatusError>> {
  return db.transaction(async (tx) => {
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
    const existingStatus = await tx.query.postStatuses.findFirst({
      where: eq(postStatuses.slug, input.slug),
    })
    if (existingStatus) {
      return err(StatusError.duplicateSlug(input.slug))
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

    return ok(status)
  })
}

/**
 * Update an existing status
 *
 * Validates that:
 * - Status exists and belongs to the organization
 * - Update data is valid
 *
 * @param id - Status ID to update
 * @param input - Update data
 * @returns Result containing the updated status or an error
 */
export async function updateStatus(
  id: StatusId,
  input: UpdateStatusInput
): Promise<Result<Status, StatusError>> {
  return db.transaction(async (tx) => {
    // Get existing status
    const existingStatus = await tx.query.postStatuses.findFirst({
      where: eq(postStatuses.id, id),
    })
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
 * - Status is not the default status
 * - No posts are using this status
 *
 * @param id - Status ID to delete
 * @returns Result containing void or an error
 */
export async function deleteStatus(id: StatusId): Promise<Result<void, StatusError>> {
  return db.transaction(async (tx) => {
    // Get existing status
    const existingStatus = await tx.query.postStatuses.findFirst({
      where: eq(postStatuses.id, id),
    })
    if (!existingStatus) {
      return err(StatusError.notFound(id))
    }

    // Check if status is the default
    if (existingStatus.isDefault) {
      return err(StatusError.cannotDeleteDefault())
    }

    // Check if any posts are using this status
    const result = await tx
      .select({ count: sql<number>`count(*)` })
      .from(posts)
      .where(eq(posts.statusId, id))

    const usageCount = Number(result[0].count)
    if (usageCount > 0) {
      return err(StatusError.cannotDeleteInUse(usageCount))
    }

    // Delete the status
    const deleteResult = await tx.delete(postStatuses).where(eq(postStatuses.id, id)).returning()
    if (deleteResult.length === 0) {
      return err(StatusError.notFound(id))
    }

    return ok(undefined)
  })
}

/**
 * Get a status by ID
 *
 * @param id - Status ID to fetch
 * @returns Result containing the status or an error
 */
export async function getStatusById(id: StatusId): Promise<Result<Status, StatusError>> {
  const status = await db.query.postStatuses.findFirst({
    where: eq(postStatuses.id, id),
  })
  if (!status) {
    return err(StatusError.notFound(id))
  }

  return ok(status)
}

/**
 * List all statuses for the organization
 *
 * Returns statuses ordered by category (active, complete, closed) and position.
 *
 * @returns Result containing array of statuses or an error
 */
export async function listStatuses(): Promise<Result<Status[], StatusError>> {
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

  return ok(statuses)
}

/**
 * Reorder statuses within a category
 *
 * Takes an array of status IDs in the desired order and updates their positions.
 *
 * Validates that:
 * - All status IDs are provided
 *
 * @param ids - Array of status IDs in desired order
 * @returns Result containing void or an error
 */
export async function reorderStatuses(ids: StatusId[]): Promise<Result<void, StatusError>> {
  return db.transaction(async (tx) => {
    // Validate input
    if (!ids || ids.length === 0) {
      return err(StatusError.validationError('Status IDs are required'))
    }

    // Reorder the statuses by updating their positions
    await Promise.all(
      ids.map((id, index) =>
        tx.update(postStatuses).set({ position: index }).where(eq(postStatuses.id, id))
      )
    )

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
 *
 * @param id - Status ID to set as default
 * @returns Result containing the updated status or an error
 */
export async function setDefaultStatus(id: StatusId): Promise<Result<Status, StatusError>> {
  return db.transaction(async (tx) => {
    // Get existing status to verify it exists
    const existingStatus = await tx.query.postStatuses.findFirst({
      where: eq(postStatuses.id, id),
    })
    if (!existingStatus) {
      return err(StatusError.notFound(id))
    }

    // Set as default (unset all others first, then set this one)
    await tx.update(postStatuses).set({ isDefault: false })
    await tx.update(postStatuses).set({ isDefault: true }).where(eq(postStatuses.id, id))

    // Fetch and return the updated status
    const updatedStatus = await tx.query.postStatuses.findFirst({
      where: eq(postStatuses.id, id),
    })
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
 * @returns Result containing the default status, null if not found, or an error
 */
export async function getDefaultStatus(): Promise<Result<Status | null, StatusError>> {
  const defaultStatus = await db.query.postStatuses.findFirst({
    where: eq(postStatuses.isDefault, true),
  })

  return ok(defaultStatus ?? null)
}

/**
 * Get a status by slug
 *
 * This method is useful for public endpoints that reference statuses by slug.
 *
 * @param slug - Status slug to find
 * @returns Result containing the status or an error
 */
export async function getStatusBySlug(slug: string): Promise<Result<Status, StatusError>> {
  const status = await db.query.postStatuses.findFirst({
    where: eq(postStatuses.slug, slug),
  })
  if (!status) {
    return err(StatusError.notFound(slug))
  }

  return ok(status)
}

/**
 * List all statuses (public, no authentication required)
 *
 * Returns statuses ordered by category (active, complete, closed) and position.
 * This method is used for public endpoints like roadmap and post detail pages.
 *
 * @returns Result containing array of statuses or an error
 */
export async function listPublicStatuses(): Promise<Result<Status[], StatusError>> {
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
