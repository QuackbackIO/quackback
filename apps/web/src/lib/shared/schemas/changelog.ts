/**
 * Zod Schemas for Changelog Operations
 *
 * Shared validation schemas used by both client and server.
 */

import { z } from 'zod'
import { tiptapContentSchema } from './posts'

/**
 * Publish state schema
 */
export const publishStateSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('draft') }),
  z.object({ type: z.literal('scheduled'), publishAt: z.coerce.date() }),
  z.object({ type: z.literal('published') }),
])

/**
 * Create changelog input schema
 */
export const createChangelogSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  contentJson: tiptapContentSchema.nullable().optional(),
  linkedPostIds: z.array(z.string()).optional(),
  publishState: publishStateSchema,
})

/**
 * Update changelog input schema
 */
export const updateChangelogSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).optional(),
  contentJson: tiptapContentSchema.nullable().optional(),
  linkedPostIds: z.array(z.string()).optional(),
  publishState: publishStateSchema.optional(),
})

/**
 * List changelogs params schema
 */
export const listChangelogsSchema = z.object({
  status: z.enum(['draft', 'scheduled', 'published', 'all']).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
})

/**
 * Get changelog by ID schema
 */
export const getChangelogSchema = z.object({
  id: z.string().min(1),
})

/**
 * Delete changelog schema
 */
export const deleteChangelogSchema = z.object({
  id: z.string().min(1),
})

/**
 * List public changelogs params schema
 */
export const listPublicChangelogsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
})

// Export types inferred from schemas
export type CreateChangelogInput = z.infer<typeof createChangelogSchema>
export type UpdateChangelogInput = z.infer<typeof updateChangelogSchema>
export type ListChangelogsParams = z.infer<typeof listChangelogsSchema>
export type PublishState = z.infer<typeof publishStateSchema>

/**
 * Convert a server-side status + publishedAt into a PublishState discriminated union.
 */
export function toPublishState(
  status: 'draft' | 'scheduled' | 'published',
  publishedAt: string | Date | null
): PublishState {
  switch (status) {
    case 'draft':
      return { type: 'draft' }
    case 'scheduled':
      return { type: 'scheduled', publishAt: publishedAt ? new Date(publishedAt) : new Date() }
    case 'published':
      return { type: 'published' }
  }
}
