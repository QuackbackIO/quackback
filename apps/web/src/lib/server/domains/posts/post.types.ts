/**
 * Input/Output types for PostService operations
 */

import type { Post, Board, Tag, TiptapContent } from '@/lib/server/db'
import type { PostId, BoardId, TagId, StatusId, PrincipalId, CommentId } from '@quackback/ids'
import type { CommentReactionCount, CommentStatusChange } from '@/lib/shared'

/**
 * Input for creating a new post
 */
export interface CreatePostInput {
  boardId: BoardId
  title: string
  content?: string
  contentJson?: TiptapContent | null
  statusId?: StatusId
  tagIds?: TagId[]
}

/**
 * Input for updating an existing post
 */
export interface UpdatePostInput {
  title?: string
  content?: string
  contentJson?: TiptapContent | null
  statusId?: StatusId
  tagIds?: TagId[]
  ownerPrincipalId?: PrincipalId | null
}

/**
 * Result of a vote operation
 */
export interface VoteResult {
  /** Whether the user now has an active vote (true = voted, false = unvoted) */
  voted: boolean
  /** New vote count for the post */
  voteCount: number
}

/**
 * Input for changing post status
 */
export interface ChangeStatusInput {
  postId: PostId
  statusId: StatusId
}

/**
 * Extended post with related data
 */
export interface PostWithDetails extends Post {
  board: {
    id: BoardId
    name: string
    slug: string
  }
  tags: Array<{
    id: TagId
    name: string
    color: string
  }>
  commentCount: number
  roadmapIds: string[]
  /** Pinned comment displayed as official response */
  pinnedComment: PinnedComment | null
  /** Author name resolved from member->user relation */
  authorName: string | null
  /** Author email resolved from member->user relation */
  authorEmail: string | null
}

/**
 * Public post list item for portal view
 */
export interface PublicPostListItem {
  id: PostId
  title: string
  content: string
  statusId: StatusId | null
  voteCount: number
  authorName: string | null
  principalId: PrincipalId | null
  createdAt: Date
  commentCount: number
  tags: Array<{ id: TagId; name: string; color: string }>
  board?: { id: BoardId; name: string; slug: string }
}

/**
 * Result for public post list queries
 */
export interface PublicPostListResult {
  items: PublicPostListItem[]
  total: number
  hasMore: boolean
}

/**
 * Parameters for inbox post list query
 */
export interface InboxPostListParams {
  boardIds?: BoardId[]
  /** Filter by status IDs (legacy, prefer statusSlugs) */
  statusIds?: StatusId[]
  /** Filter by status slugs - uses indexed lookup */
  statusSlugs?: string[]
  tagIds?: TagId[]
  /** Filter by segment IDs - posts whose author is in any of these segments */
  segmentIds?: import('@quackback/ids').SegmentId[]
  ownerId?: string | null
  search?: string
  dateFrom?: Date
  dateTo?: Date
  minVotes?: number
  minComments?: number
  /** Filter by team response state */
  responded?: 'all' | 'responded' | 'unresponded'
  updatedBefore?: Date
  sort?: 'newest' | 'oldest' | 'votes'
  /** Show only soft-deleted posts (within 30-day restorable window) */
  showDeleted?: boolean
  cursor?: string
  limit?: number
}

/**
 * Result for inbox post list query
 */
export interface InboxPostListResult {
  items: PostListItem[]
  nextCursor: string | null
  hasMore: boolean
}

/**
 * Post list item with board, tags, and comment count
 */
export interface PostListItem extends Post {
  board: Pick<Board, 'id' | 'name' | 'slug'>
  tags: Array<Pick<Tag, 'id' | 'name' | 'color'>>
  commentCount: number
  /** Author name resolved from member->user relation */
  authorName: string | null
}

/**
 * Post data for export
 */
export interface PostForExport {
  id: string
  title: string
  content: string
  statusId: StatusId | null
  voteCount: number
  authorName: string | null
  authorEmail: string | null
  createdAt: Date
  updatedAt: Date
  board: { id: string; name: string; slug: string }
  tags: Array<{ id: string; name: string; color: string }>
  statusDetails?: {
    name: string
    color: string
  }
}

/**
 * Post for roadmap view
 */
export interface RoadmapPost {
  id: string
  title: string
  statusId: StatusId | null
  voteCount: number
  board: { id: string; name: string; slug: string }
}

/**
 * Paginated result for roadmap posts
 */
export interface RoadmapPostListResult {
  items: RoadmapPost[]
  total: number
  hasMore: boolean
}

/**
 * Pinned comment serving as the official response
 */
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
 * Public comment for portal view
 */
export interface PublicComment {
  id: CommentId
  content: string
  authorName: string | null
  principalId: string | null
  createdAt: Date
  parentId: CommentId | null
  isTeamMember: boolean
  avatarUrl: string | null
  statusChange?: CommentStatusChange | null
  replies: PublicComment[]
  reactions: CommentReactionCount[]
}

/**
 * Public post detail for portal view
 */
export interface PublicPostDetail {
  id: string
  title: string
  content: string
  contentJson: TiptapContent | null
  statusId: StatusId | null
  voteCount: number
  authorName: string | null
  principalId: PrincipalId | null
  authorAvatarUrl: string | null
  createdAt: Date
  board: { id: string; name: string; slug: string }
  tags: Array<{ id: string; name: string; color: string }>
  roadmaps: Array<{ id: string; name: string; slug: string }>
  comments: PublicComment[]
  /** Pinned comment as official response */
  pinnedComment: PinnedComment | null
  /** ID of the pinned comment (for UI to identify which comment is pinned) */
  pinnedCommentId: CommentId | null
  /** Whether comments are locked (portal users can't comment) */
  isCommentsLocked: boolean
}

/**
 * Result of checking edit/delete permission
 */
export interface PermissionCheckResult {
  allowed: boolean
  reason?: string
}

/**
 * Input for user editing their own post (portal)
 */
export interface UserEditPostInput {
  title: string
  content: string
  contentJson?: TiptapContent | null
}

/**
 * Input for admin editing a post (includes status and tags)
 */
export interface AdminEditPostInput {
  postId: PostId
  title: string
  content: string
  contentJson?: TiptapContent | null
  statusId?: StatusId
  tagIds: TagId[]
}

/**
 * Post edit history entry
 */
export interface PostEditHistoryEntry {
  id: string
  postId: PostId
  editorPrincipalId: PrincipalId
  editorName?: string | null
  previousTitle: string
  previousContent: string
  previousContentJson?: unknown
  createdAt: Date
}

/**
 * Result of creating a post - includes board slug for event building
 */
export interface CreatePostResult extends Post {
  boardSlug: string
}

/**
 * Result of changing post status - includes status info for event building
 */
export interface ChangeStatusResult extends Post {
  boardSlug: string
  previousStatus: string
  newStatus: string
}

// ============================================
// Merge/Deduplication Types
// ============================================

/**
 * Input for merging a duplicate post into a canonical post
 */
export interface MergePostInput {
  /** The post to mark as a duplicate */
  duplicatePostId: PostId
  /** The canonical post to merge into */
  canonicalPostId: PostId
}

/**
 * Result of a merge operation
 */
export interface MergePostResult {
  /** The updated canonical post with recalculated vote count */
  canonicalPost: { id: PostId; voteCount: number }
  /** The duplicate post that was merged */
  duplicatePost: { id: PostId }
}

/**
 * Result of an unmerge operation
 */
export interface UnmergePostResult {
  /** The post that was unmerged (restored to independent state) */
  post: { id: PostId }
  /** The canonical post with recalculated vote count */
  canonicalPost: { id: PostId; voteCount: number }
}

/**
 * Summary of a merged (duplicate) post shown on the canonical post detail
 */
export interface MergedPostSummary {
  id: PostId
  title: string
  voteCount: number
  authorName: string | null
  createdAt: Date
  mergedAt: Date
}

/**
 * Merge info for a post that has been merged into another
 */
export interface PostMergeInfo {
  /** The canonical post this was merged into */
  canonicalPostId: PostId
  canonicalPostTitle: string
  canonicalPostBoardSlug: string
  mergedAt: Date
}
