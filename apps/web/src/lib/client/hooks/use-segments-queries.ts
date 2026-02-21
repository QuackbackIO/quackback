/**
 * Segment query hooks
 *
 * Query hooks for fetching segment data.
 * Mutations are in @/lib/client/mutations/segments.
 */

import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'

// ============================================================================
// Types (re-exported for consumer convenience)
// ============================================================================

export type SegmentListItem = Awaited<ReturnType<typeof import('@/lib/server/functions/admin').listSegmentsFn>>[number]

// ============================================================================
// Query Hooks
// ============================================================================

/** Fetch all segments with member counts. */
export function useSegments() {
  return useQuery(adminQueries.segments())
}

/** Fetch all segments, suspending while loading. */
export function useSuspenseSegments() {
  return useSuspenseQuery(adminQueries.segments())
}
