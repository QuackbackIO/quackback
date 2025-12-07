/**
 * Input/Output types for PostService operations
 */

import type { Post, PostStatus, Board, Tag } from '@quackback/db/types'

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
 * Comment node with nested replies and reactions
 */
export interface CommentNode {
  id: string
  postId: string
  parentId: string | null
  memberId: string | null
  authorId: string | null
  authorName: string | null
  authorEmail: string | null
  content: string
  isTeamMember: boolean
  createdAt: Date
  replies: CommentNode[]
  reactions: Array<{
    emoji: string
    count: number
    hasReacted: boolean
  }>
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
 */
export interface InboxPostListParams {
  organizationId: string
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
