/**
 * Server functions for tag operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { TagId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { listTags, getTagById, createTag, updateTag, deleteTag } from '@/lib/tags/tag.service'

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
  console.log(`[fn:tags] fetchTags`)
  try {
    await requireAuth({ roles: ['admin', 'member'] })

    const tags = await listTags()
    console.log(`[fn:tags] fetchTags: count=${tags.length}`)
    return tags
  } catch (error) {
    console.error(`[fn:tags] ❌ fetchTags failed:`, error)
    throw error
  }
})

/**
 * Get a single tag by ID
 */
export const fetchTag = createServerFn({ method: 'GET' })
  .inputValidator(getTagSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:tags] fetchTag: id=${data.id}`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const tag = await getTagById(data.id as TagId)
      console.log(`[fn:tags] fetchTag: found=${!!tag}`)
      return tag
    } catch (error) {
      console.error(`[fn:tags] ❌ fetchTag failed:`, error)
      throw error
    }
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
    console.log(`[fn:tags] createTagFn: name=${data.name}`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const tag = await createTag({
        name: data.name,
        color: data.color,
      })
      console.log(`[fn:tags] createTagFn: id=${tag.id}`)
      return tag
    } catch (error) {
      console.error(`[fn:tags] ❌ createTagFn failed:`, error)
      throw error
    }
  })

/**
 * Update an existing tag
 */
export const updateTagFn = createServerFn({ method: 'POST' })
  .inputValidator(updateTagSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:tags] updateTagFn: id=${data.id}`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const tag = await updateTag(data.id as TagId, {
        name: data.name,
        color: data.color,
      })
      console.log(`[fn:tags] updateTagFn: updated id=${tag.id}`)
      return tag
    } catch (error) {
      console.error(`[fn:tags] ❌ updateTagFn failed:`, error)
      throw error
    }
  })

/**
 * Delete a tag
 */
export const deleteTagFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteTagSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:tags] deleteTagFn: id=${data.id}`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      await deleteTag(data.id as TagId)
      console.log(`[fn:tags] deleteTagFn: deleted`)
      return { id: data.id as TagId }
    } catch (error) {
      console.error(`[fn:tags] ❌ deleteTagFn failed:`, error)
      throw error
    }
  })
