/**
 * Saved feedback-inbox views: the client-safe filter model, its zod validation,
 * and the view↔InboxFilters translation.
 *
 * A view is a saved filter SET, not a server-side query and not a search:
 * running it means restoring its stored filters into the ordinary inbox filter
 * state client-side and reusing the same list query. This module is the single
 * source of truth for the shape — the admin bundle and the server domain both
 * import it (the server can import shared; the client can't import
 * @quackback/db). The schema mirrors the saveable subset of `InboxFilters`
 * (lib/shared/types/filters.ts): everything except the free-text `search`,
 * which is a query, not a filter.
 */
import { z } from 'zod'
import type { PostViewId } from '@quackback/ids'
import type { InboxFilters } from '@/lib/shared/types'

// ── Filters ──────────────────────────────────────────────────────────────────

/** The inbox sorts a view can pin; 'newest' is the inbox default and drops out
 *  of the stored JSON like every other default. */
export const POST_VIEW_SORTS = ['newest', 'oldest', 'votes', 'priority'] as const
export type PostViewSort = (typeof POST_VIEW_SORTS)[number]

/**
 * The stored filter set. `.strict()` keeps a stray `search` (or any future
 * non-filter field) from silently persisting into a view. Optional fields stay
 * absent (not null) so the stored JSON is the minimal diff from the default
 * inbox.
 */
export const postViewFiltersSchema = z
  .object({
    /** Status slugs (e.g. 'open', 'planned'). */
    status: z.array(z.string().min(1)).max(50).optional(),
    board: z.array(z.string().min(1)).max(50).optional(),
    tags: z.array(z.string().min(1)).max(50).optional(),
    segmentIds: z.array(z.string().min(1)).max(50).optional(),
    /** Owner principal id, or the literal 'unassigned'. */
    owner: z.string().min(1).max(64).optional(),
    responded: z.enum(['responded', 'unresponded']).optional(),
    minVotes: z.number().int().min(0).optional(),
    minComments: z.number().int().min(0).optional(),
    hasDuplicates: z.literal(true).optional(),
    showDeleted: z.literal(true).optional(),
    sort: z.enum(POST_VIEW_SORTS).optional(),
    /** Absolute date bounds, ISO strings (a fixed window, not a rolling one). */
    dateFrom: z.string().min(1).optional(),
    dateTo: z.string().min(1).optional(),
    updatedBefore: z.string().min(1).optional(),
  })
  .strict()
export type PostViewFilters = z.infer<typeof postViewFiltersSchema>

/** A saved view as the inbox toolbar consumes it. */
export interface PostViewDTO {
  id: PostViewId
  name: string
  filters: PostViewFilters
  isShared: boolean
}

// ── Translation ──────────────────────────────────────────────────────────────

function nonEmpty<T>(arr: T[] | undefined): T[] | undefined {
  return arr && arr.length > 0 ? arr : undefined
}

/**
 * Capture the inbox's current filter set as storable view filters. The search
 * term never saves (a view is a filter set, not a query); empty arrays and the
 * 'all' responded flag drop out so two views that mean the same thing store
 * the same JSON.
 */
export function inboxFiltersToPostViewFilters(filters: InboxFilters): PostViewFilters {
  const out: PostViewFilters = {}
  const status = nonEmpty(filters.status)
  const board = nonEmpty(filters.board)
  const tags = nonEmpty(filters.tags)
  const segmentIds = nonEmpty(filters.segmentIds)
  if (status) out.status = status
  if (board) out.board = board
  if (tags) out.tags = tags
  if (segmentIds) out.segmentIds = segmentIds
  if (filters.owner) out.owner = filters.owner
  if (filters.responded && filters.responded !== 'all') out.responded = filters.responded
  if (filters.minVotes !== undefined) out.minVotes = filters.minVotes
  if (filters.minComments !== undefined) out.minComments = filters.minComments
  if (filters.hasDuplicates) out.hasDuplicates = true
  if (filters.showDeleted) out.showDeleted = true
  if (filters.sort) out.sort = filters.sort
  if (filters.dateFrom) out.dateFrom = filters.dateFrom
  if (filters.dateTo) out.dateTo = filters.dateTo
  if (filters.updatedBefore) out.updatedBefore = filters.updatedBefore
  return out
}

/**
 * Restore a view's stored filters into the inbox filter shape. The caller's
 * search term (if any) is a separate concern — merge it alongside, it is not
 * part of the view.
 */
export function postViewFiltersToInboxFilters(filters: PostViewFilters): InboxFilters {
  const out: InboxFilters = {}
  if (filters.status) out.status = filters.status
  if (filters.board) out.board = filters.board
  if (filters.tags) out.tags = filters.tags
  if (filters.segmentIds) out.segmentIds = filters.segmentIds
  if (filters.owner) out.owner = filters.owner
  if (filters.responded) out.responded = filters.responded
  if (filters.minVotes !== undefined) out.minVotes = filters.minVotes
  if (filters.minComments !== undefined) out.minComments = filters.minComments
  if (filters.hasDuplicates) out.hasDuplicates = true
  if (filters.showDeleted) out.showDeleted = true
  if (filters.sort) out.sort = filters.sort
  if (filters.dateFrom) out.dateFrom = filters.dateFrom
  if (filters.dateTo) out.dateTo = filters.dateTo
  if (filters.updatedBefore) out.updatedBefore = filters.updatedBefore
  return out
}
