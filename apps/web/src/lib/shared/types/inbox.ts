/**
 * Types for the admin inbox post detail view.
 *
 * Previously in components/admin/feedback/inbox-types.ts.
 * Moved here to centralize domain types and fix import direction.
 */

import type { Board, Tag } from '@/lib/shared/db-types'
import type { PostId, StatusId, CommentId, PrincipalId } from '@quackback/ids'
import type { CommentTreeNode, CommentReactionCount } from '@/lib/shared'

export interface PinnedComment {
  id: CommentId
  content: string
  authorName: string | null
  principalId: PrincipalId | null
  avatarUrl: string | null
  createdAt: Date
  isTeamMember: boolean
}

/**
 * Reaction count with user's reaction state.
 * Re-exported from shared for convenience.
 */
export type CommentReaction = CommentReactionCount

/**
 * Comment with nested replies and reactions.
 * This is an alias for CommentTreeNode from the shared module,
 * which is the canonical type for nested comment structures.
 */
export type CommentWithReplies = CommentTreeNode

export interface PostDetails {
  id: PostId
  title: string
  content: string
  contentJson?: unknown
  statusId: StatusId | null
  voteCount: number
  hasVoted: boolean
  // Principal-scoped identity (Hub-and-Spoke model)
  principalId: string
  ownerPrincipalId: string | null
  // Author info resolved from member->user relation
  authorName: string | null
  authorEmail: string | null
  createdAt: Date
  board: Pick<Board, 'id' | 'name' | 'slug'>
  tags: Pick<Tag, 'id' | 'name' | 'color'>[]
  comments: CommentWithReplies[]
  /** Pinned comment as official response */
  pinnedComment: PinnedComment | null
  /** ID of the pinned comment (for UI to identify which comment is pinned) */
  pinnedCommentId: CommentId | null
  /** Whether comments are locked (portal users can't comment) */
  isCommentsLocked?: boolean
  /** Map of principalId to avatar URL (base64 or external URL) */
  avatarUrls?: Record<string, string | null>
  /** IDs of roadmaps this post belongs to */
  roadmapIds?: string[]
  /** AI-generated post summary */
  summaryJson?: {
    summary: string
    keyQuotes: string[]
    nextSteps: string[]
  } | null
  /** When the summary was last updated */
  summaryUpdatedAt?: Date | null
  /** Comment count at time of summary generation (for staleness detection) */
  summaryCommentCount?: number | null
  /** Current comment count (for staleness comparison) */
  commentCount?: number
  /** When the post was soft-deleted (null if not deleted) */
  deletedAt?: Date | null
  /** Name of the member who deleted the post */
  deletedByMemberName?: string | null
  /** Merge/deduplication: ID of the canonical post this was merged into */
  canonicalPostId?: PostId | null
  /** Merge/deduplication: when this post was merged */
  mergedAt?: Date | string | null
  /** Merge/deduplication: posts merged into this one (if canonical) */
  mergedPosts?: MergedPostItem[]
  /** Merge/deduplication: info about the canonical post (if this is a duplicate) */
  mergeInfo?: {
    canonicalPostId: PostId
    canonicalPostTitle: string
    canonicalPostBoardSlug: string
    mergedAt: Date | string
  } | null
}

export interface MergedPostItem {
  id: PostId
  title: string
  voteCount: number
  authorName: string | null
  createdAt: Date | string
  mergedAt: Date | string
}

export interface CurrentUser {
  name: string
  email: string
  principalId: string
}
