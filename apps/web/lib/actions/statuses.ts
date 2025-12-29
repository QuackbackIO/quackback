'use server'

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
// Actions
// ============================================

/**
 * List all statuses for a workspace.
 */
export async function listStatusesAction(): Promise<ActionResult<Status[]>> {
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

/**
 * Get a single status by ID.
 */
export async function getStatusAction(rawInput: unknown): Promise<ActionResult<Status>> {
  const parsed = getStatusSchema.safeParse(rawInput)
  if (!parsed.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }

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

  const result = await getStatusById(parsed.data.id as StatusId)
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk(result.value)
}

/**
 * Create a new status.
 */
export async function createStatusAction(rawInput: unknown): Promise<ActionResult<Status>> {
  const parsed = createStatusSchema.safeParse(rawInput)
  if (!parsed.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }

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
    name: parsed.data.name,
    slug: parsed.data.slug,
    color: parsed.data.color,
    category: parsed.data.category,
    position: parsed.data.position,
    showOnRoadmap: parsed.data.showOnRoadmap,
    isDefault: parsed.data.isDefault,
  })
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk(result.value)
}

/**
 * Update an existing status.
 */
export async function updateStatusAction(rawInput: unknown): Promise<ActionResult<Status>> {
  const parsed = updateStatusSchema.safeParse(rawInput)
  if (!parsed.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }

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

  const result = await updateStatus(parsed.data.id as StatusId, {
    name: parsed.data.name,
    color: parsed.data.color,
    showOnRoadmap: parsed.data.showOnRoadmap,
    isDefault: parsed.data.isDefault,
  })
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk(result.value)
}

/**
 * Delete a status.
 */
export async function deleteStatusAction(rawInput: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = deleteStatusSchema.safeParse(rawInput)
  if (!parsed.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }

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

  const result = await deleteStatus(parsed.data.id as StatusId)
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk({ id: parsed.data.id })
}

/**
 * Reorder statuses within a category.
 */
export async function reorderStatusesAction(
  rawInput: unknown
): Promise<ActionResult<{ success: true }>> {
  const parsed = reorderStatusesSchema.safeParse(rawInput)
  if (!parsed.success) {
    return actionErr({
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message || 'Invalid input',
      status: 400,
    })
  }

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
  for (const id of parsed.data.statusIds) {
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
}
