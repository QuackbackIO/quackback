/**
 * Segment query hooks
 *
 * Query hooks for fetching segment data.
 * Mutations are in @/lib/client/mutations/segments.
 */

import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'

export type SegmentListItem = Awaited<
  ReturnType<typeof import('@/lib/server/functions/admin').listSegmentsFn>
>[number]

/** Fetch all segments with member counts. */
export function useSegments(options?: { enabled?: boolean }) {
  return useQuery({ ...adminQueries.segments(), enabled: options?.enabled })
}

/** Fetch all segments, suspending while loading. */
export function useSuspenseSegments() {
  return useSuspenseQuery(adminQueries.segments())
}
