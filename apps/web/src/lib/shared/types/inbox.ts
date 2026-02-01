/**
 * Types for the admin inbox post detail view.
 *
 * Previously in components/admin/feedback/inbox-types.ts.
 * Moved here to centralize domain types and fix import direction.
 */

import type { Board, Tag } from '@/lib/db-types'
import type { PostId, StatusId, CommentId, MemberId } from '@quackback/ids'
import type { CommentTreeNode, CommentReactionCount } from '@/lib/shared'

export interface OfficialResponse {
  content: string
  authorName: string | null
  respondedAt: Date
}

export interface PinnedComment {
  id: CommentId
  content: string
  authorName: string | null
  memberId: MemberId | null
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
  // Member-scoped identity (Hub-and-Spoke model)
  memberId: string | null
  ownerMemberId: string | null
  // Legacy/anonymous identity fields
  authorName: string | null
  authorEmail: string | null
  ownerId: string | null
  createdAt: Date
  board: Pick<Board, 'id' | 'name' | 'slug'>
  tags: Pick<Tag, 'id' | 'name' | 'color'>[]
  comments: CommentWithReplies[]
  officialResponse: OfficialResponse | null
  /** Pinned comment as official response (new approach) */
  pinnedComment: PinnedComment | null
  /** ID of the pinned comment (for UI to identify which comment is pinned) */
  pinnedCommentId: CommentId | null
  /** Map of memberId to avatar URL (base64 or external URL) */
  avatarUrls?: Record<string, string | null>
  /** IDs of roadmaps this post belongs to */
  roadmapIds?: string[]
  /** When the post was soft-deleted (null if not deleted) */
  deletedAt?: Date | null
  /** Name of the member who deleted the post */
  deletedByMemberName?: string | null
}

export interface CurrentUser {
  name: string
  email: string
  memberId: string
}
