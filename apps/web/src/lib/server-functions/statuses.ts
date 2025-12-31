/**
 * Server functions for status operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from './auth-helpers'
import {
  listStatuses,
  getStatusById,
  createStatus,
  updateStatus,
  deleteStatus,
  reorderStatuses,
  type Status,
} from '@/lib/statuses'
import { type StatusId } from '@quackback/ids'

// ============================================
// Schemas
// ============================================

const statusCategorySchema = z.enum(['active', 'complete', 'closed'])

const createStatusSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50, 'Name must be 50 characters or less'),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .max(50)
    .regex(/^[a-z0-9_]+$/, 'Slug must be lowercase with underscores'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid color format'),
  category: statusCategorySchema,
  position: z.number().int().min(0).optional(),
  showOnRoadmap: z.boolean().optional(),
  isDefault: z.boolean().optional(),
})

const getStatusSchema = z.object({
  id: z.string(),
})

const updateStatusSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(50).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Invalid color format')
    .optional(),
  showOnRoadmap: z.boolean().optional(),
  isDefault: z.boolean().optional(),
})

const deleteStatusSchema = z.object({
  id: z.string(),
})

const reorderStatusesSchema = z.object({
  statusIds: z.array(z.string()).min(1, 'At least one status ID is required'),
})

// ============================================
// Type Exports
// ============================================

export type StatusCategory = z.infer<typeof statusCategorySchema>
export type CreateStatusInput = z.infer<typeof createStatusSchema>
export type GetStatusInput = z.infer<typeof getStatusSchema>
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>
export type DeleteStatusInput = z.infer<typeof deleteStatusSchema>
export type ReorderStatusesInput = z.infer<typeof reorderStatusesSchema>

// ============================================
// Read Operations
// ============================================

/**
 * List all statuses for the workspace
 */
export const fetchStatuses = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['owner', 'admin', 'member'] })

  const result = await listStatuses()
  if (!result.success) {
    throw new Error(result.error.message)
  }
  return result.value
})

/**
 * Get a single status by ID
 */
export const fetchStatus = createServerFn({ method: 'GET' })
  .inputValidator(getStatusSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['owner', 'admin', 'member'] })

    const result = await getStatusById(data.id as StatusId)
    if (!result.success) {
      throw new Error(result.error.message)
    }
    return result.value
  })

// ============================================
// Write Operations
// ============================================

/**
 * Create a new status
 */
export const createStatusFn = createServerFn({ method: 'POST' })
  .inputValidator(createStatusSchema)
  .handler(async ({ data }): Promise<Status> => {
    await requireAuth({ roles: ['owner', 'admin', 'member'] })

    const result = await createStatus({
      name: data.name,
      slug: data.slug,
      color: data.color,
      category: data.category,
      position: data.position,
      showOnRoadmap: data.showOnRoadmap,
      isDefault: data.isDefault,
    })
    if (!result.success) {
      throw new Error(result.error.message)
    }
    return result.value
  })

/**
 * Update an existing status
 */
export const updateStatusFn = createServerFn({ method: 'POST' })
  .inputValidator(updateStatusSchema)
  .handler(async ({ data }): Promise<Status> => {
    await requireAuth({ roles: ['owner', 'admin', 'member'] })

    const result = await updateStatus(data.id as StatusId, {
      name: data.name,
      color: data.color,
      showOnRoadmap: data.showOnRoadmap,
      isDefault: data.isDefault,
    })
    if (!result.success) {
      throw new Error(result.error.message)
    }
    return result.value
  })

/**
 * Delete a status
 */
export const deleteStatusFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteStatusSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['owner', 'admin', 'member'] })

    const result = await deleteStatus(data.id as StatusId)
    if (!result.success) {
      throw new Error(result.error.message)
    }
    return { id: data.id }
  })

/**
 * Reorder statuses
 */
export const reorderStatusesFn = createServerFn({ method: 'POST' })
  .inputValidator(reorderStatusesSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['owner', 'admin', 'member'] })

    const result = await reorderStatuses(data.statusIds as StatusId[])
    if (!result.success) {
      throw new Error(result.error.message)
    }
    return result.value
  })
