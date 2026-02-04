/**
 * API response types for the Quackback REST API
 *
 * These represent the wire format of API responses, decoupled from the database schema.
 * The API wraps data in { data: T, meta?: { pagination } } format.
 */

// Posts

export interface ApiPost {
  id: string
  title: string
  content: string | null
  voteCount: number
  commentCount: number
  boardId: string
  boardSlug?: string
  boardName?: string
  statusId: string | null
  authorName: string | null
  ownerId: string | null
  tags: Array<{ id: string; name: string; color: string }>
  createdAt: string
  updatedAt: string
}

export interface ApiPostDetail extends ApiPost {
  contentJson: unknown
  officialResponse: string | null
  officialResponseAuthorName: string | null
  officialResponseAt: string | null
  roadmapIds: string[]
  pinnedComment: ApiComment | null
  deletedAt: string | null
}

// Comments

export interface ApiComment {
  id: string
  postId: string
  parentId: string | null
  content: string
  authorName: string | null
  memberId: string | null
  isTeamMember: boolean
  createdAt: string
  reactions?: unknown
  replies?: ApiComment[]
}

// Boards

export interface ApiBoard {
  id: string
  name: string
  slug: string
  description: string | null
  isPublic: boolean
  postCount: number
  createdAt: string
  updatedAt: string
}

// Statuses

export interface ApiStatus {
  id: string
  name: string
  slug: string
  color: string
  category: 'active' | 'complete' | 'closed'
  position: number
  showOnRoadmap: boolean
  isDefault: boolean
  createdAt: string
}

// Tags

export interface ApiTag {
  id: string
  name: string
  color: string
}

// Roadmaps

export interface ApiRoadmap {
  id: string
  name: string
  slug: string
  isPublic: boolean
}

// Members

export interface ApiMember {
  id: string
  name: string
  role: 'admin' | 'member'
  // Note: email intentionally omitted for privacy
}

// Changelog

export interface ApiChangelogEntry {
  id: string
  title: string
  content: string
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

// API Response Wrappers

export interface ApiResponse<T> {
  data: T
  meta?: {
    pagination?: PaginationMeta
  }
}

export interface PaginationMeta {
  cursor: string | null
  hasMore: boolean
  total?: number
}
