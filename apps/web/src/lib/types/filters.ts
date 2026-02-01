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
  owner?: string | 'unassigned'
  dateFrom?: string
  dateTo?: string
  minVotes?: number
  sort?: 'newest' | 'oldest' | 'votes'
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
}

/**
 * Filters for the admin users list.
 */
export interface UsersFilters {
  search?: string
  verified?: boolean
  dateFrom?: string
  dateTo?: string
  sort?: 'newest' | 'oldest' | 'most_active' | 'name'
}
