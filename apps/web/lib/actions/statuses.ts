'use server'

import { z } from 'zod'
import { withAction, mapDomainError } from './with-action'
import { actionOk, actionErr } from './types'
import { getStatusService } from '@/lib/services'
import { workspaceIdSchema, statusIdSchema, isValidTypeId, type StatusId } from '@quackback/ids'

// ============================================
// Schemas
// ============================================

const statusCategorySchema = z.enum(['active', 'complete', 'closed'])

const listStatusesSchema = z.object({
  workspaceId: workspaceIdSchema,
})

const createStatusSchema = z.object({
  workspaceId: workspaceIdSchema,
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
  workspaceId: workspaceIdSchema,
  id: statusIdSchema,
})

const updateStatusSchema = z.object({
  workspaceId: workspaceIdSchema,
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
  workspaceId: workspaceIdSchema,
  id: statusIdSchema,
})

const reorderStatusesSchema = z.object({
  workspaceId: workspaceIdSchema,
  statusIds: z.array(z.string()).min(1, 'At least one status ID is required'),
})

// ============================================
// Type Exports
// ============================================

export type StatusCategory = z.infer<typeof statusCategorySchema>
export type ListStatusesInput = z.infer<typeof listStatusesSchema>
export type CreateStatusInput = z.infer<typeof createStatusSchema>
export type GetStatusInput = z.infer<typeof getStatusSchema>
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>
export type DeleteStatusInput = z.infer<typeof deleteStatusSchema>
export type ReorderStatusesInput = z.infer<typeof reorderStatusesSchema>

// ============================================
// Actions
// ============================================

/**
 * List all statuses for a workspace.
 */
export const listStatusesAction = withAction(
  listStatusesSchema,
  async (_input, _ctx, serviceCtx) => {
    const result = await getStatusService().listStatuses(serviceCtx)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  }
)

/**
 * Get a single status by ID.
 */
export const getStatusAction = withAction(getStatusSchema, async (input, _ctx, serviceCtx) => {
  const result = await getStatusService().getStatusById(input.id as StatusId, serviceCtx)
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk(result.value)
})

/**
 * Create a new status.
 */
export const createStatusAction = withAction(
  createStatusSchema,
  async (input, _ctx, serviceCtx) => {
    const result = await getStatusService().createStatus(
      {
        name: input.name,
        slug: input.slug,
        color: input.color,
        category: input.category,
        position: input.position,
        showOnRoadmap: input.showOnRoadmap,
        isDefault: input.isDefault,
      },
      serviceCtx
    )
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  },
  { roles: ['owner', 'admin', 'member'] }
)

/**
 * Update an existing status.
 */
export const updateStatusAction = withAction(
  updateStatusSchema,
  async (input, _ctx, serviceCtx) => {
    const result = await getStatusService().updateStatus(
      input.id as StatusId,
      {
        name: input.name,
        color: input.color,
        showOnRoadmap: input.showOnRoadmap,
        isDefault: input.isDefault,
      },
      serviceCtx
    )
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  },
  { roles: ['owner', 'admin', 'member'] }
)

/**
 * Delete a status.
 */
export const deleteStatusAction = withAction(
  deleteStatusSchema,
  async (input, _ctx, serviceCtx) => {
    const result = await getStatusService().deleteStatus(input.id as StatusId, serviceCtx)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ id: input.id as string })
  },
  { roles: ['owner', 'admin', 'member'] }
)

/**
 * Reorder statuses within a category.
 */
export const reorderStatusesAction = withAction(
  reorderStatusesSchema,
  async (input, _ctx, serviceCtx) => {
    // Validate all status IDs
    const validatedStatusIds = input.statusIds.map((id) => {
      if (!isValidTypeId(id, 'status')) {
        throw new Error(`Invalid status ID format: ${id}`)
      }
      return id as StatusId
    })

    const result = await getStatusService().reorderStatuses(validatedStatusIds, serviceCtx)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ success: true })
  },
  { roles: ['owner', 'admin', 'member'] }
)
