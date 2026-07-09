/**
 * User domain types
 *
 * Types for portal user management operations.
 */

import type { PrincipalId, PostStatusId, SegmentId } from '@quackback/ids'

// ============================================
// Segment summary (embedded in user records)
// ============================================

export interface UserSegmentSummary {
  id: SegmentId
  name: string
  color: string
  type: 'manual' | 'dynamic'
}

/**
 * Portal user list item with activity counts
 *
 * Portal users have role='user' in the member table (unified model).
 * They can vote/comment on portal but don't have admin access.
 */
export interface PortalUserListItem {
  principalId: PrincipalId
  userId: string
  name: string | null
  email: string | null
  image: string | null
  emailVerified: boolean
  joinedAt: Date
  postCount: number
  commentCount: number
  voteCount: number
  segments: UserSegmentSummary[]
  /** Raw metadata JSON string — parsed at the route layer into `attributes` */
  metadata: string | null
  /** Lead = engaged anonymous principal (type='anonymous'); see lifecycle doc. */
  isLead: boolean
  /** Email a lead volunteered mid-conversation (unverified, self-asserted). */
  contactEmail: string | null
  /** Freshest activity signal: session touch or device beacon; null = none. */
  lastSeenAt: Date | null
}

/**
 * Portal user list item for client components (Date fields may be strings after serialization)
 */
export interface PortalUserListItemView {
  principalId: PrincipalId
  userId: string
  name: string | null
  email: string | null
  image: string | null
  emailVerified: boolean
  joinedAt: Date | string
  postCount: number
  commentCount: number
  voteCount: number
  segments: UserSegmentSummary[]
  metadata: string | null
  isLead: boolean
  contactEmail: string | null
  lastSeenAt: Date | string | null
}

/**
 * Parsed activity count filter (e.g. "gte:5" → { op: 'gte', value: 5 })
 */
export interface ActivityCountFilter {
  op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq'
  value: number
}

/**
 * Parsed custom attribute filter
 */
export interface CustomAttrFilter {
  key: string
  op: string
  value: string
}

/**
 * Parameters for listing portal users
 */
export interface PortalUserListParams {
  search?: string
  verified?: boolean
  dateFrom?: Date
  dateTo?: Date
  /** Email domain filter (e.g. "example.com") */
  emailDomain?: string
  /** Activity count filters */
  postCount?: ActivityCountFilter
  voteCount?: ActivityCountFilter
  commentCount?: ActivityCountFilter
  /** Custom attribute filters */
  customAttrs?: CustomAttrFilter[]
  sort?:
    | 'newest'
    | 'oldest'
    | 'most_active'
    | 'last_active'
    | 'most_posts'
    | 'most_comments'
    | 'most_votes'
    | 'name'
  page?: number
  limit?: number
  /** Filter by segment IDs (OR logic — users in ANY of the given segments) */
  segmentIds?: import('@quackback/ids').SegmentId[]
  /**
   * Lifecycle view over the three-tier people model:
   * - visitor: anonymous with no engagement yet (idle minted session, or an
   *   agent-started conversation they never replied to). Not a directory row;
   *   the analytics Visitors section covers that tier.
   * - lead ('leads'): anonymous (type='anonymous') AND engaged — authored a
   *   message/post/vote/comment/reaction or volunteered a contact email
   *   (unverified). Enforced by leadEngagementWhere() in user.service.ts.
   * - user ('users', default): verified identified account (type='user');
   *   the identity merge carries a lead's history forward on sign-in.
   */
  lifecycle?: 'users' | 'leads'
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
 * Paginated result for portal user list (client view with serialized dates)
 */
export interface PortalUserListResultView {
  items: PortalUserListItemView[]
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
  statusId: PostStatusId | null
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
 * Full portal user detail with engaged posts and segments
 */
export interface PortalUserDetail extends PortalUserListItem {
  createdAt: Date // user.createdAt (account creation)
  /** All posts this user has engaged with (authored, commented, or voted on) */
  engagedPosts: EngagedPost[]
}

// ============================================
// API input/result types for user CRUD
// ============================================

/**
 * Input for the identify (upsert) endpoint.
 * Creates a new user or updates an existing one by email.
 */
export interface IdentifyPortalUserInput {
  email: string
  name?: string
  image?: string
  emailVerified?: boolean
  /** Customer-provided external user ID (e.g. from your own system) */
  externalId?: string | null
  attributes?: Record<string, unknown>
}

/**
 * Result of the identify operation.
 */
export interface IdentifyPortalUserResult {
  principalId: PrincipalId
  userId: string
  name: string
  email: string
  image: string | null
  emailVerified: boolean
  externalId: string | null
  attributes: Record<string, unknown>
  createdAt: Date
  /** true if a new user was created, false if an existing user was updated */
  created: boolean
  /**
   * True when THIS call asserted the email as verified: the user was created
   * with emailVerified=true, or an existing user was flipped false -> true.
   * Callers audit the assertion (`user.email_verified.asserted`) when set —
   * asserting a verified email is a trust decision that grants portal access.
   */
  emailVerifiedAsserted: boolean
}

/**
 * Input for the PATCH update endpoint.
 */
export interface UpdatePortalUserInput {
  name?: string
  image?: string | null
  emailVerified?: boolean
  /** Customer-provided external user ID (e.g. from your own system) */
  externalId?: string | null
  attributes?: Record<string, unknown>
}

/**
 * Result of the update operation.
 */
export interface UpdatePortalUserResult {
  principalId: PrincipalId
  userId: string
  name: string
  email: string | null
  image: string | null
  emailVerified: boolean
  externalId: string | null
  attributes: Record<string, unknown>
  createdAt: Date
}
