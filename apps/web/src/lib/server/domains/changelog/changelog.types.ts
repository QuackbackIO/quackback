/**
 * Input/Output types for Changelog Service operations
 */

import type { TiptapContent } from '@quackback/db/types'
import type { BoardId, ChangelogId, MemberId, PostId } from '@quackback/ids'

// ============================================================================
// Input Types
// ============================================================================

/**
 * Input for creating a new changelog entry
 */
export interface CreateChangelogInput {
  boardId: BoardId
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
 * Publish state for a changelog entry
 */
export type PublishState =
  | { type: 'draft' }
  | { type: 'scheduled'; publishAt: Date }
  | { type: 'published' }

/**
 * Parameters for listing changelog entries
 */
export interface ListChangelogParams {
  boardId?: BoardId
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
 * Changelog entry with author and linked posts
 */
export interface ChangelogEntryWithDetails {
  id: ChangelogId
  boardId: BoardId
  title: string
  content: string
  contentJson: TiptapContent | null
  memberId: MemberId | null
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
  /** Author information (if available) */
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
  id: MemberId
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
 * Public changelog entry for portal view
 */
export interface PublicChangelogEntry {
  id: ChangelogId
  title: string
  content: string
  contentJson: TiptapContent | null
  publishedAt: Date
  author: ChangelogAuthor | null
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
}

/**
 * Public changelog list result
 */
export interface PublicChangelogListResult {
  items: PublicChangelogEntry[]
  nextCursor: string | null
  hasMore: boolean
}
