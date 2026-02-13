/**
 * Input/Output types for Changelog Service operations
 */

import type { TiptapContent } from '@quackback/db/types'
import type { ChangelogId, PrincipalId, PostId } from '@quackback/ids'
import type { PublishState } from '@/lib/shared/schemas/changelog'

export type { PublishState } from '@/lib/shared/schemas/changelog'

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
  /** Publish state */
  publishState: PublishState
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
  /** Publish state (if changing) */
  publishState?: PublishState
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
  createdAt: Date
  updatedAt: Date
  /** Author information - only shown in admin views */
  author: ChangelogAuthor | null
  /** Linked posts */
  linkedPosts: ChangelogLinkedPost[]
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
