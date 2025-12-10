/**
 * Input/Output types for PostService operations
 */

import type { Post, PostStatus, Board, Tag } from '@quackback/db/types'
import type { CommentReactionCount } from '../comments/comment.types'

/**
 * Input for creating a new post
 */
export interface CreatePostInput {
  boardId: string
  title: string
  content: string
  contentJson?: unknown // TipTap JSON
  status?: PostStatus
  tagIds?: string[]
}

/**
 * Input for updating an existing post
 */
export interface UpdatePostInput {
  title?: string
  content?: string
  contentJson?: unknown // TipTap JSON
  status?: PostStatus
  tagIds?: string[]
  ownerId?: string | null
  ownerMemberId?: string | null
  officialResponse?: string | null
  officialResponseMemberId?: string | null
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
  postId: string
  statusId: string
}

/**
 * Extended post with related data
 */
export interface PostWithDetails extends Post {
  board: {
    id: string
    name: string
    slug: string
    organizationId: string
  }
  tags: Array<{
    id: string
    name: string
    color: string
  }>
  commentCount: number
}

/**
 * Public post list item for portal view
 */
export interface PublicPostListItem {
  id: string
  title: string
  content: string
  status: PostStatus
  voteCount: number
  authorName: string | null
  memberId: string | null
  createdAt: Date
  commentCount: number
  tags: Array<{ id: string; name: string; color: string }>
  board?: { id: string; name: string; slug: string }
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
 * Note: organizationId comes from ServiceContext, not these params
 */
export interface InboxPostListParams {
  boardIds?: string[]
  status?: PostStatus[]
  tagIds?: string[]
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
  status: PostStatus
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
  status: PostStatus
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
  status: PostStatus
  voteCount: number
  authorName: string | null
  createdAt: Date
  board: { id: string; name: string; slug: string }
  tags: Array<{ id: string; name: string; color: string }>
  comments: PublicComment[]
  officialResponse: OfficialResponse | null
}
