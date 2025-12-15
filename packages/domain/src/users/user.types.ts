/**
 * User domain types
 *
 * Types for portal user management operations.
 */

import type { MemberId, StatusId } from '@quackback/ids'

/**
 * Portal user list item with activity counts
 *
 * Portal users have role='user' in the member table (unified model).
 * They can vote/comment on portal but don't have admin access.
 */
export interface PortalUserListItem {
  memberId: MemberId
  userId: string
  name: string | null
  email: string
  image: string | null
  emailVerified: boolean
  joinedAt: Date
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
  statusId: StatusId | null
  statusName: string | null
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
