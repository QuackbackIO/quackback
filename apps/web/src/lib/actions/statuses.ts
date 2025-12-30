import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSession } from '@/lib/auth/server'
import { db, member, eq } from '@/lib/db'
import {
  listStatuses,
  getStatusById,
  createStatus,
  updateStatus,
  deleteStatus,
  reorderStatuses,
  type Status,
} from '@/lib/statuses'
import { statusIdSchema, isValidTypeId, type StatusId, type UserId } from '@quackback/ids'
import { actionOk, actionErr, mapDomainError, type ActionResult } from './types'

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
// Server Functions
// ============================================

/**
 * List all statuses for a workspace.
 */
export const listStatusesAction = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ActionResult<Status[]>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    const result = await listStatuses()
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  }
)

/**
 * Get a single status by ID.
 */
export const getStatusAction = createServerFn({ method: 'POST' })
  .inputValidator(getStatusSchema)
  .handler(async ({ data }): Promise<ActionResult<Status>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    const result = await getStatusById(data.id as StatusId)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  })

/**
 * Create a new status.
 */
export const createStatusAction = createServerFn({ method: 'POST' })
  .inputValidator(createStatusSchema)
  .handler(async ({ data }): Promise<ActionResult<Status>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin', 'member'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

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
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  })

/**
 * Update an existing status.
 */
export const updateStatusAction = createServerFn({ method: 'POST' })
  .inputValidator(updateStatusSchema)
  .handler(async ({ data }): Promise<ActionResult<Status>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin', 'member'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const result = await updateStatus(data.id as StatusId, {
      name: data.name,
      color: data.color,
      showOnRoadmap: data.showOnRoadmap,
      isDefault: data.isDefault,
    })
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  })

/**
 * Delete a status.
 */
export const deleteStatusAction = createServerFn({ method: 'POST' })
  .inputValidator(deleteStatusSchema)
  .handler(async ({ data }): Promise<ActionResult<{ id: string }>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin', 'member'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    const result = await deleteStatus(data.id as StatusId)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ id: data.id })
  })

/**
 * Reorder statuses within a category.
 */
export const reorderStatusesAction = createServerFn({ method: 'POST' })
  .inputValidator(reorderStatusesSchema)
  .handler(async ({ data }): Promise<ActionResult<{ success: true }>> => {
    const session = await getSession()
    if (!session?.user) {
      return actionErr({ code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id as UserId),
    })
    if (!memberRecord) {
      return actionErr({ code: 'FORBIDDEN', message: 'Access denied', status: 403 })
    }

    if (!['owner', 'admin', 'member'].includes(memberRecord.role)) {
      return actionErr({ code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 })
    }

    // Validate all status IDs
    const validatedStatusIds: StatusId[] = []
    for (const id of data.statusIds) {
      if (!isValidTypeId(id, 'status')) {
        return actionErr({
          code: 'VALIDATION_ERROR',
          message: `Invalid status ID format: ${id}`,
          status: 400,
        })
      }
      validatedStatusIds.push(id as StatusId)
    }

    const result = await reorderStatuses(validatedStatusIds)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ success: true })
  })
