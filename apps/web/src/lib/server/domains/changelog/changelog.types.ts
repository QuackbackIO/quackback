/**
 * Input/Output types for Changelog Service operations
 */

import type { TiptapContent } from '@/lib/server/db'
import type { ChangelogId, ChangelogCategoryId, PrincipalId, PostId } from '@quackback/ids'
import type { PublishState } from '@/lib/shared/schemas/changelog'

export type { PublishState } from '@/lib/shared/schemas/changelog'

/** Category summary attached to an entry (admin + public projections). */
export interface ChangelogCategorySummary {
  id: ChangelogCategoryId
  name: string
  color: string
}

// ============================================================================
// Input Types
// ============================================================================

/**
 * Input for creating a new changelog entry
 */
export interface CreateChangelogInput {
  title: string
  content: string
  contentJson?: TiptapContent | null
  /** IDs of posts to link to this changelog entry */
  linkedPostIds?: PostId[]
  /** IDs of categories (labels) to attach to this changelog entry */
  categoryIds?: ChangelogCategoryId[]
  /** Publish state */
  publishState: PublishState
  displayDate?: Date | null
  /**
   * Whether publishing this entry should dispatch the subscriber
   * notification. Defaults to true; false stamps `notifiedAt` without
   * sending (the atomic-claim idempotence still applies — see
   * notifyChangelogPublished).
   */
  notify?: boolean
}

/**
 * Input for updating an existing changelog entry
 */
export interface UpdateChangelogInput {
  title?: string
  content?: string
  contentJson?: TiptapContent | null
  /** IDs of posts to link (replaces existing links) */
  linkedPostIds?: PostId[]
  /** IDs of categories to attach (replaces existing links) */
  categoryIds?: ChangelogCategoryId[]
  /** Publish state (if changing) */
  publishState?: PublishState
  displayDate?: Date | null
  /** See {@link CreateChangelogInput.notify}. */
  notify?: boolean
}

/**
 * Parameters for listing changelog entries
 */
export interface ListChangelogParams {
  /** Filter by status */
  status?: 'draft' | 'scheduled' | 'published' | 'all'
  /** Cursor-based pagination */
  cursor?: string
  /** Number of items to return */
  limit?: number
}

// ============================================================================
// Output Types
// ============================================================================

/**
 * Changelog entry with author and linked posts (admin view)
 */
export interface ChangelogEntryWithDetails {
  id: ChangelogId
  title: string
  content: string
  contentJson: TiptapContent | null
  principalId: PrincipalId | null
  publishedAt: Date | null
  displayDate: Date | null
  createdAt: Date
  updatedAt: Date
  /** Author information - only shown in admin views */
  author: ChangelogAuthor | null
  /** Linked posts */
  linkedPosts: ChangelogLinkedPost[]
  /** Attached categories (labels) */
  categories: ChangelogCategorySummary[]
  /** Computed status based on publishedAt */
  status: 'draft' | 'scheduled' | 'published'
}

/**
 * Changelog author information
 */
export interface ChangelogAuthor {
  id: PrincipalId
  name: string
  avatarUrl: string | null
}

/**
 * Linked post summary for changelog
 */
export interface ChangelogLinkedPost {
  id: PostId
  title: string
  voteCount: number
  status: {
    name: string
    color: string
  } | null
}

/**
 * Paginated changelog list result
 */
export interface ChangelogListResult {
  items: ChangelogEntryWithDetails[]
  nextCursor: string | null
  hasMore: boolean
}

/**
 * Public changelog entry for portal view (no author info)
 */
export interface PublicChangelogEntry {
  id: ChangelogId
  title: string
  content: string
  contentJson: TiptapContent | null
  publishedAt: Date
  linkedPosts: PublicChangelogLinkedPost[]
  categories: ChangelogCategorySummary[]
}

/**
 * Public linked post for changelog portal
 */
export interface PublicChangelogLinkedPost {
  id: PostId
  title: string
  voteCount: number
  boardSlug: string
  status: {
    name: string
    color: string
  } | null
}

/**
 * Public changelog list result
 */
export interface PublicChangelogListResult {
  items: PublicChangelogEntry[]
  nextCursor: string | null
  hasMore: boolean
}
