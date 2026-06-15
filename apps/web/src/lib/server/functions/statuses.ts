/**
 * Server functions for status operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { StatusId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import {
  listStatuses,
  getStatusById,
  createStatus,
  updateStatus,
  deleteStatus,
  reorderStatuses,
} from '@/lib/server/domains/statuses/status.service'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'statuses' })

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
export const fetchStatusesFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch statuses')
  try {
    await requireAuth({ roles: ['admin', 'member'] })

    const statuses = await listStatuses()
    log.debug({ count: statuses.length }, 'fetch statuses count')
    return statuses
  } catch (error) {
    log.error({ err: error }, 'fetch statuses failed')
    throw error
  }
})

/**
 * Get a single status by ID
 */
export const fetchStatusFn = createServerFn({ method: 'GET' })
  .inputValidator(getStatusSchema)
  .handler(async ({ data }) => {
    log.debug({ status_id: data.id }, 'fetch status')
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const status = await getStatusById(data.id as StatusId)
      log.debug({ found: !!status }, 'fetch status result')
      return status
    } catch (error) {
      log.error({ err: error }, 'fetch status failed')
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
    log.debug({ category: data.category }, 'create status')
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const status = await createStatus(data)
      log.info({ status_id: status.id }, 'status created')
      return status
    } catch (error) {
      log.error({ err: error }, 'create status failed')
      throw error
    }
  })

/**
 * Update an existing status
 */
export const updateStatusFn = createServerFn({ method: 'POST' })
  .inputValidator(updateStatusSchema)
  .handler(async ({ data }) => {
    log.debug({ status_id: data.id }, 'update status')
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const status = await updateStatus(data.id as StatusId, {
        name: data.name,
        color: data.color,
        showOnRoadmap: data.showOnRoadmap,
        isDefault: data.isDefault,
      })
      log.info({ status_id: status.id }, 'status updated')
      return status
    } catch (error) {
      log.error({ err: error }, 'update status failed')
      throw error
    }
  })

/**
 * Delete a status
 */
export const deleteStatusFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteStatusSchema)
  .handler(async ({ data }) => {
    log.debug({ status_id: data.id }, 'delete status')
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      await deleteStatus(data.id as StatusId)
      log.info({ status_id: data.id }, 'status deleted')
      return { id: data.id as StatusId }
    } catch (error) {
      log.error({ err: error }, 'delete status failed')
      throw error
    }
  })

/**
 * Reorder statuses
 */
export const reorderStatusesFn = createServerFn({ method: 'POST' })
  .inputValidator(reorderStatusesSchema)
  .handler(async ({ data }) => {
    log.debug({ count: data.statusIds.length }, 'reorder statuses')
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      await reorderStatuses(data.statusIds as StatusId[])
      log.info({ count: data.statusIds.length }, 'statuses reordered')
      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'reorder statuses failed')
      throw error
    }
  })
