/**
 * Server functions for status operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { statusIdSchema } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import {
  listStatuses,
  getStatusById,
  createStatus,
  updateStatus,
  deleteStatus,
  reorderStatuses,
} from '@/lib/statuses/status.service'

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
  id: statusIdSchema,
})

const updateStatusSchema = z.object({
  id: statusIdSchema,
  name: z.string().min(1).max(50).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Invalid color format')
    .optional(),
  showOnRoadmap: z.boolean().optional(),
  isDefault: z.boolean().optional(),
})

const deleteStatusSchema = z.object({
  id: statusIdSchema,
})

const reorderStatusesSchema = z.object({
  statusIds: z.array(statusIdSchema).min(1, 'At least one status ID is required'),
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
  console.log(`[fn:statuses] fetchStatuses`)
  try {
    await requireAuth({ roles: ['admin', 'member'] })

    const statuses = await listStatuses()
    console.log(`[fn:statuses] fetchStatuses: count=${statuses.length}`)
    return statuses
  } catch (error) {
    console.error(`[fn:statuses] ❌ fetchStatuses failed:`, error)
    throw error
  }
})

/**
 * Get a single status by ID
 */
export const fetchStatus = createServerFn({ method: 'GET' })
  .inputValidator(getStatusSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:statuses] fetchStatus: id=${data.id}`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const status = await getStatusById(data.id)
      console.log(`[fn:statuses] fetchStatus: found=${!!status}`)
      return status
    } catch (error) {
      console.error(`[fn:statuses] ❌ fetchStatus failed:`, error)
      throw error
    }
  })

// ============================================
// Write Operations
// ============================================

/**
 * Create a new status
 */
export const createStatusFn = createServerFn({ method: 'POST' })
  .inputValidator(createStatusSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:statuses] createStatusFn: name=${data.name}, category=${data.category}`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const status = await createStatus(data)
      console.log(`[fn:statuses] createStatusFn: id=${status.id}`)
      return status
    } catch (error) {
      console.error(`[fn:statuses] ❌ createStatusFn failed:`, error)
      throw error
    }
  })

/**
 * Update an existing status
 */
export const updateStatusFn = createServerFn({ method: 'POST' })
  .inputValidator(updateStatusSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:statuses] updateStatusFn: id=${data.id}`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const status = await updateStatus(data.id, {
        name: data.name,
        color: data.color,
        showOnRoadmap: data.showOnRoadmap,
        isDefault: data.isDefault,
      })
      console.log(`[fn:statuses] updateStatusFn: updated id=${status.id}`)
      return status
    } catch (error) {
      console.error(`[fn:statuses] ❌ updateStatusFn failed:`, error)
      throw error
    }
  })

/**
 * Delete a status
 */
export const deleteStatusFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteStatusSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:statuses] deleteStatusFn: id=${data.id}`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      await deleteStatus(data.id)
      console.log(`[fn:statuses] deleteStatusFn: deleted`)
      return { id: data.id }
    } catch (error) {
      console.error(`[fn:statuses] ❌ deleteStatusFn failed:`, error)
      throw error
    }
  })

/**
 * Reorder statuses
 */
export const reorderStatusesFn = createServerFn({ method: 'POST' })
  .inputValidator(reorderStatusesSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:statuses] reorderStatusesFn: count=${data.statusIds.length}`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      await reorderStatuses(data.statusIds)
      console.log(`[fn:statuses] reorderStatusesFn: reordered`)
      return { success: true }
    } catch (error) {
      console.error(`[fn:statuses] ❌ reorderStatusesFn failed:`, error)
      throw error
    }
  })
