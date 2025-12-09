/**
 * User domain types
 *
 * Types for portal user management operations.
 */

/**
 * Portal user list item with activity counts
 */
export interface PortalUserListItem {
  memberId: string
  userId: string
  name: string | null
  email: string
  image: string | null
  emailVerified: boolean
  joinedAt: Date
  role: string
  postCount: number
  commentCount: number
  voteCount: number
}

/**
 * Parameters for listing portal users
 */
export interface PortalUserListParams {
  search?: string
  verified?: boolean
  dateFrom?: Date
  dateTo?: Date
  sort?: 'newest' | 'oldest' | 'most_active' | 'name'
  page?: number
  limit?: number
}

/**
 * Paginated result for portal user list
 */
export interface PortalUserListResult {
  items: PortalUserListItem[]
  total: number
  hasMore: boolean
}

/**
 * Engagement type for a post
 */
export type EngagementType = 'authored' | 'commented' | 'voted'

/**
 * Post the user has engaged with (authored, commented, or voted on)
 */
export interface EngagedPost {
  id: string
  title: string
  content: string
  status: string
  statusColor: string
  voteCount: number
  commentCount: number
  boardSlug: string
  boardName: string
  authorName: string | null
  createdAt: Date
  /** Types of engagement this user has with the post */
  engagementTypes: EngagementType[]
  /** Most recent engagement date */
  engagedAt: Date
}

/**
 * Full portal user detail with engaged posts
 */
export interface PortalUserDetail extends PortalUserListItem {
  createdAt: Date // user.createdAt (account creation)
  /** All posts this user has engaged with (authored, commented, or voted on) */
  engagedPosts: EngagedPost[]
}
