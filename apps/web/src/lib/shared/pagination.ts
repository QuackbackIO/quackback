/**
 * Shared pagination types
 */

/**
 * Pagination parameters for list operations.
 */
export interface PaginationParams {
  /** Maximum number of items to return */
  limit?: number
  /** Number of items to skip (offset-based pagination) */
  offset?: number
  /** Cursor for cursor-based pagination */
  cursor?: string
}

/**
 * Paginated result wrapper.
 * Contains items along with pagination metadata.
 */
export interface PaginatedResult<T> {
  /** Array of items for the current page */
  items: T[]
  /** Total count of items across all pages */
  total: number
  /** Whether more items exist after this page */
  hasMore: boolean
  /** Cursor for fetching the next page (cursor-based pagination) */
  nextCursor?: string
}
