/**
 * Segment query hooks
 *
 * Query hooks for fetching segment data.
 * Mutations are in @/lib/client/mutations/segments.
 */

import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'

export type SegmentListItem = Awaited<
  ReturnType<typeof import('@/lib/server/functions/admin').listSegmentsFn>
>[number]

/** Fetch all segments with member counts. */
export function useSegments(options?: { enabled?: boolean }) {
  return useQuery({ ...adminQueries.segments(), enabled: options?.enabled })
}

/**
 * The segments for an admin page's filters, read only by a viewer holding
 * segment.view (what listSegmentsFn requires): for anyone else there are none
 * to offer, rather than a request the server refuses. Admin pages only.
 */
export function useAdminSegments() {
  return useSegments({ enabled: usePermission(PERMISSIONS.SEGMENT_VIEW) })
}

/** Fetch all segments, suspending while loading. */
export function useSuspenseSegments() {
  return useSuspenseQuery(adminQueries.segments())
}
