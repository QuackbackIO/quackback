/**
 * Server functions for tag operations
 *
 * NOTE: All service imports are done dynamically inside handlers
 * to prevent client bundling issues with TanStack Start.
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { type TagId } from '@quackback/ids'

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
  const { requireAuth } = await import('./auth-helpers')
  const { listTags } = await import('@/lib/tags/tag.service')

  await requireAuth({ roles: ['admin', 'member'] })

  return await listTags()
})

/**
 * Get a single tag by ID
 */
export const fetchTag = createServerFn({ method: 'GET' })
  .inputValidator(getTagSchema)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('./auth-helpers')
    const { getTagById } = await import('@/lib/tags/tag.service')

    await requireAuth({ roles: ['admin', 'member'] })

    return await getTagById(data.id as TagId)
  })

// ============================================
// Write Operations
// ============================================

/**
 * Create a new tag
 */
export const createTagFn = createServerFn({ method: 'POST' })
  .inputValidator(createTagSchema)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('./auth-helpers')
    const { createTag } = await import('@/lib/tags/tag.service')

    await requireAuth({ roles: ['admin', 'member'] })

    return await createTag({
      name: data.name,
      color: data.color,
    })
  })

/**
 * Update an existing tag
 */
export const updateTagFn = createServerFn({ method: 'POST' })
  .inputValidator(updateTagSchema)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('./auth-helpers')
    const { updateTag } = await import('@/lib/tags/tag.service')

    await requireAuth({ roles: ['admin', 'member'] })

    return await updateTag(data.id as TagId, {
      name: data.name,
      color: data.color,
    })
  })

/**
 * Delete a tag
 */
export const deleteTagFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteTagSchema)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('./auth-helpers')
    const { deleteTag } = await import('@/lib/tags/tag.service')

    await requireAuth({ roles: ['admin', 'member'] })

    await deleteTag(data.id as TagId)
    return { id: data.id }
  })
