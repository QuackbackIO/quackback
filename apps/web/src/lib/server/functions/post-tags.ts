/**
 * Server functions for tag operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { BoardId, PostTagId } from '@quackback/ids'
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
  aiPrompt: z.string().max(500).optional(),
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
  aiPrompt: z.string().max(500).optional().nullable(),
})

const deleteTagSchema = z.object({
  id: z.string(),
})

const backfillAiTagsSchema = z.object({
  boardId: z.string(),
})

// ============================================
// Type Exports
// ============================================

export type CreateTagInput = z.infer<typeof createTagSchema>
export type GetTagInput = z.infer<typeof getTagSchema>
export type UpdateTagInput = z.infer<typeof updateTagSchema>
export type DeleteTagInput = z.infer<typeof deleteTagSchema>
export type BackfillAiTagsInput = z.infer<typeof backfillAiTagsSchema>

// ============================================
// Read Operations
// ============================================

/**
 * List all tags for the workspace
 */
export const fetchTags = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug({}, 'fetch tags')
  await requireAuth({ permission: PERMISSIONS.TAG_VIEW })

  const tags = await listPostTags()
  log.debug({ count: tags.length }, 'fetch tags')
  return tags
})

/**
 * Get a single tag by ID
 */
export const fetchTag = createServerFn({ method: 'GET' })
  .validator(getTagSchema)
  .handler(async ({ data }) => {
    log.debug({ tag_id: data.id }, 'fetch tag')
    await requireAuth({ permission: PERMISSIONS.TAG_VIEW })

    const tag = await getTagById(data.id as PostTagId)
    log.debug({ found: !!tag }, 'fetch tag')
    return tag
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
    await requireAuth({ permission: PERMISSIONS.TAG_MANAGE })

    const tag = await createPostTag({
      name: data.name,
      color: data.color,
      description: data.description,
      aiPrompt: data.aiPrompt,
    })
    log.info({ tag_id: tag.id }, 'tag created')
    return tag
  })

/**
 * Update an existing tag
 */
export const updatePostTagFn = createServerFn({ method: 'POST' })
  .validator(updateTagSchema)
  .handler(async ({ data }) => {
    log.debug({ tag_id: data.id }, 'update tag')
    await requireAuth({ permission: PERMISSIONS.TAG_MANAGE })

    const before = await getTagById(data.id as PostTagId)
    const tag = await updatePostTag(data.id as PostTagId, {
      name: data.name,
      color: data.color,
      description: data.description,
      aiPrompt: data.aiPrompt,
    })
    log.info({ tag_id: tag.id }, 'tag updated')

    // A changed, non-empty AI prompt re-evaluates the tag against recent
    // posts so the new rule takes effect on existing feedback. Best-effort:
    // a re-evaluation failure never fails the tag save.
    if (data.aiPrompt !== undefined && tag.aiPrompt && tag.aiPrompt !== before.aiPrompt) {
      try {
        const { reevaluateAiTag } = await import('@/lib/server/domains/posts/post.autotag')
        const result = await reevaluateAiTag(tag.id)
        log.info({ tag_id: tag.id, ...result }, 'ai tag re-evaluated after prompt change')
      } catch (err) {
        log.warn({ err, tag_id: tag.id }, 'ai tag re-evaluation failed')
      }
    }
    return tag
  })

/**
 * Delete a tag
 */
export const deletePostTagFn = createServerFn({ method: 'POST' })
  .validator(deleteTagSchema)
  .handler(async ({ data }) => {
    log.debug({ tag_id: data.id }, 'delete tag')
    await requireAuth({ permission: PERMISSIONS.TAG_MANAGE })

    await deletePostTag(data.id as PostTagId)
    log.info({ tag_id: data.id }, 'tag deleted')
    return { id: data.id as PostTagId }
  })

/**
 * Apply the AI-prompted tags to a board's existing untagged posts in one
 * action. Batched — the result's `hasMore` tells the caller to run again.
 */
export const backfillAiTagsFn = createServerFn({ method: 'POST' })
  .validator(backfillAiTagsSchema)
  .handler(async ({ data }) => {
    log.debug({ board_id: data.boardId }, 'ai tag backfill')
    await requireAuth({ permission: PERMISSIONS.TAG_MANAGE })

    const { backfillAiTagsForBoard } = await import('@/lib/server/domains/posts/post.autotag')
    const result = await backfillAiTagsForBoard(data.boardId as BoardId)
    log.info({ board_id: data.boardId, ...result }, 'ai tag backfill applied')
    return result
  })
