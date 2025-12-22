'use server'

import { z } from 'zod'
import { withAction, mapDomainError } from './with-action'
import { actionOk, actionErr } from './types'
import { getTagService } from '@/lib/services'
import { tagIdSchema, type TagId } from '@quackback/ids'

// ============================================
// Schemas
// ============================================

const listTagsSchema = z.object({})

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

export type ListTagsInput = z.infer<typeof listTagsSchema>
export type CreateTagInput = z.infer<typeof createTagSchema>
export type GetTagInput = z.infer<typeof getTagSchema>
export type UpdateTagInput = z.infer<typeof updateTagSchema>
export type DeleteTagInput = z.infer<typeof deleteTagSchema>

// ============================================
// Actions
// ============================================

/**
 * List all tags for a workspace.
 */
export const listTagsAction = withAction(listTagsSchema, async (_input, _ctx, serviceCtx) => {
  const result = await getTagService().listTags(serviceCtx)
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk(result.value)
})

/**
 * Get a single tag by ID.
 */
export const getTagAction = withAction(getTagSchema, async (input, _ctx, serviceCtx) => {
  const result = await getTagService().getTagById(input.id as TagId, serviceCtx)
  if (!result.success) {
    return actionErr(mapDomainError(result.error))
  }
  return actionOk(result.value)
})

/**
 * Create a new tag.
 */
export const createTagAction = withAction(
  createTagSchema,
  async (input, _ctx, serviceCtx) => {
    const result = await getTagService().createTag(
      { name: input.name, color: input.color },
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
 * Update an existing tag.
 */
export const updateTagAction = withAction(
  updateTagSchema,
  async (input, _ctx, serviceCtx) => {
    const result = await getTagService().updateTag(
      input.id as TagId,
      { name: input.name, color: input.color },
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
 * Delete a tag.
 */
export const deleteTagAction = withAction(
  deleteTagSchema,
  async (input, _ctx, serviceCtx) => {
    const result = await getTagService().deleteTag(input.id as TagId, serviceCtx)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ id: input.id as string })
  },
  { roles: ['owner', 'admin', 'member'] }
)
