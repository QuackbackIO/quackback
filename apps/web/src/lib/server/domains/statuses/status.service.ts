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

import { db, eq, sql, posts, postStatuses, asc } from '@/lib/server/db'
import { tenantStorage } from '@/lib/server/tenant'
import { toUuid, type StatusId } from '@quackback/ids'
import {
  NotFoundError,
  ValidationError,
  ConflictError,
  ForbiddenError,
  InternalError,
} from '@/lib/shared/errors'
import type { Status, CreateStatusInput, UpdateStatusInput } from './status.types'

/**
 * Atomically set a status as default, unsetting all others in a single query.
 * This prevents race conditions where concurrent requests could result in
 * multiple defaults or no defaults.
 */
async function setStatusAsDefaultAtomic(statusId: StatusId): Promise<void> {
  const statusUuid = toUuid(statusId)
  await db.execute(sql`
    UPDATE post_statuses
    SET is_default = (id = ${statusUuid})
    WHERE is_default = true OR id = ${statusUuid}
  `)
}

/**
 * Create a new status
 */
export async function createStatus(input: CreateStatusInput): Promise<Status> {
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

  // Check if slug already exists (moved outside transaction for neon-http compatibility)
  const existingStatus = await db.query.postStatuses.findFirst({
    where: eq(postStatuses.slug, input.slug),
  })
  if (existingStatus) {
    throw new ConflictError('DUPLICATE_SLUG', `A status with slug '${input.slug}' already exists`)
  }

  // Create the status
  const [status] = await db
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

  // If this is marked as default, ensure only one default exists (atomic operation)
  if (input.isDefault) {
    await setStatusAsDefaultAtomic(status.id)
  }

  return status
}

/**
 * Update an existing status
 */
export async function updateStatus(id: StatusId, input: UpdateStatusInput): Promise<Status> {
  // Get existing status (moved outside transaction for neon-http compatibility)
  const existingStatus = await db.query.postStatuses.findFirst({
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

  // If setting as default, use atomic operation to prevent race conditions
  if (input.isDefault === true) {
    await setStatusAsDefaultAtomic(id)
  }

  // Build update data
  const updateData: Partial<Status> = {}
  if (input.name !== undefined) updateData.name = input.name.trim()
  if (input.color !== undefined) updateData.color = input.color
  if (input.showOnRoadmap !== undefined) updateData.showOnRoadmap = input.showOnRoadmap
  if (input.isDefault === false) updateData.isDefault = false

  // Update the status
  const [updatedStatus] = await db
    .update(postStatuses)
    .set(updateData)
    .where(eq(postStatuses.id, id))
    .returning()

  if (!updatedStatus) {
    throw new NotFoundError('STATUS_NOT_FOUND', `Status with ID ${id} not found`)
  }

  return updatedStatus
}

/**
 * Delete a status
 */
export async function deleteStatus(id: StatusId): Promise<void> {
  // Get existing status (moved outside transaction for neon-http compatibility)
  const existingStatus = await db.query.postStatuses.findFirst({
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
  const result = await db
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
  const deleteResult = await db.delete(postStatuses).where(eq(postStatuses.id, id)).returning()
  if (deleteResult.length === 0) {
    throw new NotFoundError('STATUS_NOT_FOUND', `Status with ID ${id} not found`)
  }
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
 * Uses a single batch UPDATE with CASE WHEN for efficiency
 */
export async function reorderStatuses(ids: StatusId[]): Promise<void> {
  // Validate input
  if (!ids || ids.length === 0) {
    throw new ValidationError('VALIDATION_ERROR', 'Status IDs are required')
  }

  // Build CASE WHEN clause for batch update
  const cases = ids
    .map((id, i) => sql`WHEN id = ${toUuid(id)} THEN ${i}`)
    .reduce((acc, curr) => sql`${acc} ${curr}`, sql``)
  const uuids = ids.map((id) => toUuid(id))

  // Single UPDATE with CASE expression
  await db.execute(sql`
    UPDATE post_statuses
    SET position = CASE ${cases} END
    WHERE id = ANY(${uuids}::uuid[])
  `)
}

/**
 * Set a status as the default for new posts
 */
export async function setDefaultStatus(id: StatusId): Promise<Status> {
  // Get existing status to verify it exists (moved outside transaction for neon-http compatibility)
  const existingStatus = await db.query.postStatuses.findFirst({
    where: eq(postStatuses.id, id),
  })
  if (!existingStatus) {
    throw new NotFoundError('STATUS_NOT_FOUND', `Status with ID ${id} not found`)
  }

  // Set as default atomically to prevent race conditions
  await setStatusAsDefaultAtomic(id)

  // Fetch and return the updated status
  const updatedStatus = await db.query.postStatuses.findFirst({
    where: eq(postStatuses.id, id),
  })
  if (!updatedStatus) {
    throw new NotFoundError('STATUS_NOT_FOUND', `Status with ID ${id} not found`)
  }

  return updatedStatus
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

const STATUSES_CACHE_KEY = 'public_statuses'

/**
 * List all statuses (public, no authentication required).
 * Results are cached per-request since statuses rarely change.
 */
export async function listPublicStatuses(): Promise<Status[]> {
  // Check request-scoped cache first
  const ctx = tenantStorage.getStore()
  const cached = ctx?.cache.get(STATUSES_CACHE_KEY) as Status[] | undefined
  if (cached) {
    return cached
  }

  try {
    const statuses = await db.query.postStatuses.findMany({
      orderBy: [asc(postStatuses.category), asc(postStatuses.position)],
    })

    // Cache for subsequent calls within this request
    ctx?.cache.set(STATUSES_CACHE_KEY, statuses)

    return statuses
  } catch (error) {
    throw new InternalError(
      'DATABASE_ERROR',
      `Failed to fetch statuses: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}
