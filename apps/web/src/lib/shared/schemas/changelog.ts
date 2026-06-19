/**
 * Zod Schemas for Changelog Operations
 *
 * Shared validation schemas used by both client and server.
 */

import { z } from 'zod'
import { ACCESS_TIERS } from '@/lib/shared/db-types'
import { tiptapContentSchema } from './posts'

/**
 * Publish state schema
 */
export const publishStateSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('draft') }),
  z.object({ type: z.literal('scheduled'), publishAt: z.coerce.date() }),
  z.object({ type: z.literal('published'), publishAt: z.coerce.date().optional() }),
])

/**
 * Changelog audience visibility schema.
 *
 * The view-only mirror of the roadmap access schema. A changelog entry has a
 * single `view` action across the full tier surface (Public / Signed-in /
 * Segments / Private). The only rule is that selecting the `segments` tier
 * requires a non-empty allowlist (an empty list would hide the entry from
 * everyone). This gate is orthogonal to publish lifecycle.
 */
export const changelogAccessSchema = z
  .object({
    view: z.enum(ACCESS_TIERS),
    segments: z.object({
      view: z.array(z.string()).max(50, 'At most 50 segments per changelog entry.'),
    }),
  })
  .superRefine((val, ctx) => {
    if (val.view === 'segments' && val.segments.view.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['segments', 'view'],
        message: 'Pick at least one segment — an empty allowlist hides the entry.',
      })
    }
  })

/**
 * Create changelog input schema
 */
export const createChangelogSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string(),
  contentJson: tiptapContentSchema.nullable().optional(),
  linkedPostIds: z.array(z.string()).optional(),
  publishState: publishStateSchema,
  access: changelogAccessSchema.optional(),
})

/**
 * Update changelog input schema
 */
export const updateChangelogSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  content: z.string().optional(),
  contentJson: tiptapContentSchema.nullable().optional(),
  linkedPostIds: z.array(z.string()).optional(),
  publishState: publishStateSchema.optional(),
  access: changelogAccessSchema.optional(),
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
 * The publishedAt value is carried through for published entries so that later
 * updates don't silently reset the publish date to `now()` — the update path in
 * changelog.service.ts does `state.publishAt ?? new Date()` and would otherwise
 * clobber the original timestamp every time anything on the entry was edited.
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
      return {
        type: 'published',
        publishAt: publishedAt ? new Date(publishedAt) : undefined,
      }
  }
}

/**
 * Derive a PublishState from an optional publishedAt ISO datetime string.
 *
 * - No value / undefined -> draft
 * - Future date -> scheduled (carries the target date)
 * - Past or current date -> published (carries the date so backdating works;
 *   without this, the service layer falls back to `new Date()` and the entry
 *   gets stamped with the current moment instead of the requested past date)
 */
export function publishedAtToPublishState(publishedAt?: string): PublishState {
  if (!publishedAt) {
    return { type: 'draft' }
  }
  const publishDate = new Date(publishedAt)
  if (publishDate > new Date()) {
    return { type: 'scheduled', publishAt: publishDate }
  }
  return { type: 'published', publishAt: publishDate }
}
