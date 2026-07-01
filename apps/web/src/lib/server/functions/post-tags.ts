/**
 * Server functions for tag operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { PostTagId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  listPostTags,
  getTagById,
  createPostTag,
  updatePostTag,
  deletePostTag,
} from '@/lib/server/domains/post-tags/post-tag.service'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'tags' })

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
  description: z.string().max(200).optional(),
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
  description: z.string().max(200).optional().nullable(),
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
  log.debug({}, 'fetch tags')
  try {
    await requireAuth({ permission: PERMISSIONS.TAG_VIEW })

    const tags = await listPostTags()
    log.debug({ count: tags.length }, 'fetch tags')
    return tags
  } catch (error) {
    log.error({ err: error }, 'fetch tags failed')
    throw error
  }
})

/**
 * Get a single tag by ID
 */
export const fetchTag = createServerFn({ method: 'GET' })
  .validator(getTagSchema)
  .handler(async ({ data }) => {
    log.debug({ tag_id: data.id }, 'fetch tag')
    try {
      await requireAuth({ permission: PERMISSIONS.TAG_VIEW })

      const tag = await getTagById(data.id as PostTagId)
      log.debug({ found: !!tag }, 'fetch tag')
      return tag
    } catch (error) {
      log.error({ err: error }, 'fetch tag failed')
      throw error
    }
  })

// ============================================
// Write Operations
// ============================================

/**
 * Create a new tag
 */
export const createPostTagFn = createServerFn({ method: 'POST' })
  .validator(createTagSchema)
  .handler(async ({ data }) => {
    log.debug({ name: data.name }, 'create tag')
    try {
      await requireAuth({ permission: PERMISSIONS.TAG_MANAGE })

      const tag = await createPostTag({
        name: data.name,
        color: data.color,
        description: data.description,
      })
      log.info({ tag_id: tag.id }, 'tag created')
      return tag
    } catch (error) {
      log.error({ err: error }, 'create tag failed')
      throw error
    }
  })

/**
 * Update an existing tag
 */
export const updatePostTagFn = createServerFn({ method: 'POST' })
  .validator(updateTagSchema)
  .handler(async ({ data }) => {
    log.debug({ tag_id: data.id }, 'update tag')
    try {
      await requireAuth({ permission: PERMISSIONS.TAG_MANAGE })

      const tag = await updatePostTag(data.id as PostTagId, {
        name: data.name,
        color: data.color,
        description: data.description,
      })
      log.info({ tag_id: tag.id }, 'tag updated')
      return tag
    } catch (error) {
      log.error({ err: error }, 'update tag failed')
      throw error
    }
  })

/**
 * Delete a tag
 */
export const deletePostTagFn = createServerFn({ method: 'POST' })
  .validator(deleteTagSchema)
  .handler(async ({ data }) => {
    log.debug({ tag_id: data.id }, 'delete tag')
    try {
      await requireAuth({ permission: PERMISSIONS.TAG_MANAGE })

      await deletePostTag(data.id as PostTagId)
      log.info({ tag_id: data.id }, 'tag deleted')
      return { id: data.id as PostTagId }
    } catch (error) {
      log.error({ err: error }, 'delete tag failed')
      throw error
    }
  })
