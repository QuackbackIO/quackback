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
  sort?: 'newest' | 'oldest' | 'votes' | 'priority'
  showDeleted?: boolean
}

/**
 * The responded filter values for public portal filtering.
 */
export type RespondedFilter = 'responded' | 'unresponded'

/** Portal feed views for a signed-in viewer: ideas they posted, voted on or follow. */
export const PUBLIC_FEED_VIEWS = ['mine', 'voted', 'following'] as const
export type PublicFeedView = (typeof PUBLIC_FEED_VIEWS)[number]

/** Portal filter panel counts, keyed by status slug, board slug and view. */
export interface PublicPostFacetCounts {
  statuses: Record<string, number>
  boards: Record<string, number>
  /** Null for anonymous viewers, who have no views. */
  views: Record<PublicFeedView, number> | null
}

/**
 * With no status picked, the portal feed shows only active-category posts,
 * except while searching, so shipped and closed ideas can still be found.
 * The query and the status chip both read this, so they never disagree.
 */
export function feedShowsActiveOnly(search: string | undefined): boolean {
  return !search
}

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
  /**
   * Team-only: owner principal id, or the literal 'unassigned' for posts with
   * no owner. Applied server-side only for callers holding post.view_private;
   * silently ignored otherwise.
   */
  owner?: string
  /**
   * Team-only: filter to posts authored by users in any of these segments.
   * Applied server-side only for post.view_private holders.
   */
  segmentIds?: string[]
  /** Signed-in viewers: only ideas they posted, voted on or follow. */
  view?: PublicFeedView
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
  /** User tag selection (multi-select, OR logic) */
  tagIds?: string[]
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
  /** Companies-tab filters, same encoding (reserved keys: plan, mrr). */
  companyAttrs?: string
  /** Lifecycle view: identified users (default), engaged anonymous leads, or
   *  the companies directory. */
  lifecycle?: 'users' | 'leads' | 'companies'
  sort?:
    | 'newest'
    | 'oldest'
    | 'most_active'
    | 'last_active'
    | 'most_posts'
    | 'most_comments'
    | 'most_votes'
    | 'name'
}
