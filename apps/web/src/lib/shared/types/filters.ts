/**
 * Filter types for list views.
 *
 * These types define the filter parameters used across admin and portal views.
 * Centralized here to prevent circular dependencies between lib/ and components/.
 */

/**
 * Filters for the admin inbox post list.
 */
export interface InboxFilters {
  search?: string
  /** Status slugs for filtering (e.g., 'open', 'planned') */
  status?: string[]
  board?: string[]
  tags?: string[]
  /** Segment IDs - filter posts whose author is in any of these segments */
  segmentIds?: string[]
  owner?: string | 'unassigned'
  dateFrom?: string
  dateTo?: string
  minVotes?: number
  minComments?: number
  responded?: 'all' | 'responded' | 'unresponded'
  updatedBefore?: string
  /** Only show posts with pending duplicate suggestions */
  hasDuplicates?: boolean
  sort?: 'newest' | 'oldest' | 'votes'
  showDeleted?: boolean
}

/**
 * The responded filter values for public portal filtering.
 */
export type RespondedFilter = 'responded' | 'unresponded'

/**
 * Filters for the public portal post list.
 */
export interface PublicFeedbackFilters {
  board?: string
  search?: string
  sort?: 'top' | 'new' | 'trending'
  status?: string[]
  tagIds?: string[]
  minVotes?: number
  dateFrom?: string
  responded?: RespondedFilter
}

/**
 * Filters for roadmap views (admin and public portal).
 * Both views share the same filter shape. On the public portal, segmentIds
 * is only populated when the viewer is an admin/member.
 */
export interface RoadmapFilters {
  search?: string
  board?: string[]
  tags?: string[]
  /** Segment IDs - filter posts whose author is in any of these segments */
  segmentIds?: string[]
  sort?: 'votes' | 'newest' | 'oldest'
}

/**
 * Filters for the admin suggestions list.
 */
export interface SuggestionsFilters {
  search?: string
  sourceTypes?: string[]
  sort?: 'newest' | 'relevance'
  status?: 'pending' | 'dismissed'
  /** Selected suggestion ID (for URL persistence) */
  suggestion?: string
}

/**
 * Filters for the admin users list.
 */
export interface UsersFilters {
  search?: string
  /** Segment selection from sidebar (multi-select, like statuses for posts) */
  segmentIds?: string[]
  verified?: boolean
  dateFrom?: string
  dateTo?: string
  /** Email domain filter (e.g. "example.com") */
  emailDomain?: string
  /** Activity count filters: "operator:value" format (e.g. "gte:5") */
  postCount?: string
  voteCount?: string
  commentCount?: string
  /** Custom attribute filters: "key:op:value,key2:op:value2" */
  customAttrs?: string
  /** Include anonymous users (principal.type='anonymous'). Default: false. */
  includeAnonymous?: boolean
  sort?:
    | 'newest'
    | 'oldest'
    | 'most_active'
    | 'most_posts'
    | 'most_comments'
    | 'most_votes'
    | 'name'
}
