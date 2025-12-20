/**
 * Input/Output types for PostService operations
 */

import type { Post, Board, Tag } from '@quackback/db/types'
import type { PostId, BoardId, TagId, StatusId, MemberId, WorkspaceId } from '@quackback/ids'
import type { CommentReactionCount } from '../comments/comment.types'

/**
 * Input for creating a new post
 */
export interface CreatePostInput {
  boardId: BoardId
  title: string
  content: string
  contentJson?: unknown // TipTap JSON
  statusId?: StatusId
  tagIds?: TagId[]
}

/**
 * Input for updating an existing post
 */
export interface UpdatePostInput {
  title?: string
  content?: string
  contentJson?: unknown // TipTap JSON
  statusId?: StatusId
  tagIds?: TagId[]
  ownerId?: string | null
  ownerMemberId?: MemberId | null
  officialResponse?: string | null
  officialResponseMemberId?: MemberId | null
  officialResponseAuthorName?: string | null
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
    workspaceId: WorkspaceId
  }
  tags: Array<{
    id: TagId
    name: string
    color: string
  }>
  commentCount: number
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
  memberId: MemberId | null
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
 * Note: workspaceId comes from ServiceContext, not these params
 */
export interface InboxPostListParams {
  boardIds?: BoardId[]
  /** Filter by status IDs (legacy, prefer statusSlugs) */
  statusIds?: StatusId[]
  /** Filter by status slugs - uses indexed lookup */
  statusSlugs?: string[]
  tagIds?: TagId[]
  ownerId?: string | null
  search?: string
  dateFrom?: Date
  dateTo?: Date
  minVotes?: number
  sort?: 'newest' | 'oldest' | 'votes'
  page?: number
  limit?: number
}

/**
 * Result for inbox post list query
 */
export interface InboxPostListResult {
  items: PostListItem[]
  total: number
  hasMore: boolean
}

/**
 * Post list item with board, tags, and comment count
 */
export interface PostListItem extends Post {
  board: Pick<Board, 'id' | 'name' | 'slug'>
  tags: Array<Pick<Tag, 'id' | 'name' | 'color'>>
  commentCount: number
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
 * Official response on a post
 */
export interface OfficialResponse {
  content: string
  authorName: string | null
  respondedAt: Date
}

/**
 * Public comment for portal view
 */
export interface PublicComment {
  id: string
  content: string
  authorName: string | null
  memberId: string | null
  createdAt: Date
  parentId: string | null
  isTeamMember: boolean
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
  contentJson: unknown
  statusId: StatusId | null
  voteCount: number
  authorName: string | null
  createdAt: Date
  board: { id: string; name: string; slug: string }
  tags: Array<{ id: string; name: string; color: string }>
  comments: PublicComment[]
  officialResponse: OfficialResponse | null
}

/**
 * Result of checking edit/delete permission
 */
export interface PermissionCheckResult {
  allowed: boolean
  reason?: string
}

/**
 * Input for user editing their own post
 */
export interface UserEditPostInput {
  title: string
  content: string
  contentJson?: unknown
}

/**
 * Post edit history entry
 */
export interface PostEditHistoryEntry {
  id: string
  postId: PostId
  editorMemberId: MemberId
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
