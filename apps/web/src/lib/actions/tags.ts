import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSession } from '@/lib/auth/server'
import { db, member, eq } from '@/lib/db'
import { listTags, getTagById, createTag, updateTag, deleteTag } from '@/lib/tags'
import { tagIdSchema, type TagId, type UserId } from '@quackback/ids'
import { actionOk, actionErr, mapDomainError, type ActionResult } from './types'
import type { Tag } from '@quackback/db'

// ============================================
// Schemas
// ============================================

const createTagSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50, 'Name must be 50 characters or less'),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex color')
    .optional()
    .default('#6b7280'),
})

const getTagSchema = z.object({
  id: tagIdSchema,
})

const updateTagSchema = z.object({
  id: tagIdSchema,
  name: z.string().min(1).max(50).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
})

const deleteTagSchema = z.object({
  id: tagIdSchema,
})

// ============================================
// Type Exports
// ============================================

export type CreateTagInput = z.infer<typeof createTagSchema>
export type GetTagInput = z.infer<typeof getTagSchema>
export type UpdateTagInput = z.infer<typeof updateTagSchema>
export type DeleteTagInput = z.infer<typeof deleteTagSchema>

// ============================================
// Server Functions
// ============================================

/**
 * List all tags for a workspace.
 */
export const listTagsAction = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ActionResult<Tag[]>> => {
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

    const result = await listTags()
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  }
)

/**
 * Get a single tag by ID.
 */
export const getTagAction = createServerFn({ method: 'POST' })
  .inputValidator(getTagSchema)
  .handler(async ({ data }): Promise<ActionResult<Tag>> => {
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

    const result = await getTagById(data.id as TagId)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  })

/**
 * Create a new tag.
 */
export const createTagAction = createServerFn({ method: 'POST' })
  .inputValidator(createTagSchema)
  .handler(async ({ data }): Promise<ActionResult<Tag>> => {
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

    const result = await createTag({ name: data.name, color: data.color })
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  })

/**
 * Update an existing tag.
 */
export const updateTagAction = createServerFn({ method: 'POST' })
  .inputValidator(updateTagSchema)
  .handler(async ({ data }): Promise<ActionResult<Tag>> => {
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

    const result = await updateTag(data.id as TagId, {
      name: data.name,
      color: data.color,
    })
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk(result.value)
  })

/**
 * Delete a tag.
 */
export const deleteTagAction = createServerFn({ method: 'POST' })
  .inputValidator(deleteTagSchema)
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

    const result = await deleteTag(data.id as TagId)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ id: data.id })
  })
