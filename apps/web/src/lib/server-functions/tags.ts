/**
 * Server functions for tag operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from './auth-helpers'
import { listTags, getTagById, createTag, updateTag, deleteTag } from '@/lib/tags'
import { type TagId } from '@quackback/ids'
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
  id: z.string(),
})

const updateTagSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(50).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
})

const deleteTagSchema = z.object({
  id: z.string(),
})

// ============================================
// Type Exports
// ============================================

export type CreateTagInput = z.infer<typeof createTagSchema>
export type GetTagInput = z.infer<typeof getTagSchema>
export type UpdateTagInput = z.infer<typeof updateTagSchema>
export type DeleteTagInput = z.infer<typeof deleteTagSchema>

// ============================================
// Read Operations
// ============================================

/**
 * List all tags for the workspace
 */
export const fetchTags = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['owner', 'admin', 'member'] })

  const result = await listTags()
  if (!result.success) {
    throw new Error(result.error.message)
  }
  return result.value
})

/**
 * Get a single tag by ID
 */
export const fetchTag = createServerFn({ method: 'GET' })
  .inputValidator(getTagSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['owner', 'admin', 'member'] })

    const result = await getTagById(data.id as TagId)
    if (!result.success) {
      throw new Error(result.error.message)
    }
    return result.value
  })

// ============================================
// Write Operations
// ============================================

/**
 * Create a new tag
 */
export const createTagFn = createServerFn({ method: 'POST' })
  .inputValidator(createTagSchema)
  .handler(async ({ data }): Promise<Tag> => {
    await requireAuth({ roles: ['owner', 'admin', 'member'] })

    const result = await createTag({
      name: data.name,
      color: data.color,
    })
    if (!result.success) {
      throw new Error(result.error.message)
    }
    return result.value
  })

/**
 * Update an existing tag
 */
export const updateTagFn = createServerFn({ method: 'POST' })
  .inputValidator(updateTagSchema)
  .handler(async ({ data }): Promise<Tag> => {
    await requireAuth({ roles: ['owner', 'admin', 'member'] })

    const result = await updateTag(data.id as TagId, {
      name: data.name,
      color: data.color,
    })
    if (!result.success) {
      throw new Error(result.error.message)
    }
    return result.value
  })

/**
 * Delete a tag
 */
export const deleteTagFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteTagSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['owner', 'admin', 'member'] })

    const result = await deleteTag(data.id as TagId)
    if (!result.success) {
      throw new Error(result.error.message)
    }
    return { id: data.id }
  })
