/**
 * Segment mutations
 *
 * React Query mutations for segment management.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SegmentId, PrincipalId } from '@quackback/ids'
import {
  createSegmentFn,
  updateSegmentFn,
  deleteSegmentFn,
  assignUsersToSegmentFn,
  removeUsersFromSegmentFn,
  evaluateSegmentFn,
  evaluateAllSegmentsFn,
} from '@/lib/server/functions/admin'

// ============================================================================
// Helpers
// ============================================================================

const SEGMENTS_KEY = ['admin', 'segments']
const USERS_KEY = ['users']

// ============================================================================
// Mutations
// ============================================================================

/** Create a new segment. */
export function useCreateSegment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      name: string
      description?: string
      type: 'manual' | 'dynamic'
      color?: string
      rules?: {
        match: 'all' | 'any'
        conditions: Array<{
          attribute: string
          operator: string
          value: string | number | boolean
          metadataKey?: string
        }>
      }
      evaluationSchedule?: { enabled: boolean; pattern: string }
      weightConfig?: {
        attribute: {
          key: string
          label: string
          type: 'string' | 'number' | 'boolean' | 'date' | 'currency'
          currencyCode?: string
        }
        aggregation: 'sum' | 'average' | 'count' | 'median'
      }
    }) => createSegmentFn({ data: input as Parameters<typeof createSegmentFn>[0]['data'] }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SEGMENTS_KEY })
    },
  })
}

/** Update an existing segment. */
export function useUpdateSegment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      segmentId: SegmentId
      name?: string
      description?: string | null
      color?: string
      rules?: {
        match: 'all' | 'any'
        conditions: Array<{
          attribute: string
          operator: string
          value: string | number | boolean
          metadataKey?: string
        }>
      } | null
      evaluationSchedule?: { enabled: boolean; pattern: string } | null
      weightConfig?: {
        attribute: {
          key: string
          label: string
          type: 'string' | 'number' | 'boolean' | 'date' | 'currency'
          currencyCode?: string
        }
        aggregation: 'sum' | 'average' | 'count' | 'median'
      } | null
    }) =>
      updateSegmentFn({
        data: input as Parameters<typeof updateSegmentFn>[0]['data'],
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SEGMENTS_KEY })
      void queryClient.invalidateQueries({ queryKey: USERS_KEY })
    },
  })
}

/** Delete a segment. */
export function useDeleteSegment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (segmentId: SegmentId) => deleteSegmentFn({ data: { segmentId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SEGMENTS_KEY })
      void queryClient.invalidateQueries({ queryKey: USERS_KEY })
    },
  })
}

/** Assign users to a manual segment. */
export function useAssignUsersToSegment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      segmentId,
      principalIds,
    }: {
      segmentId: SegmentId
      principalIds: PrincipalId[]
    }) => assignUsersToSegmentFn({ data: { segmentId, principalIds } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SEGMENTS_KEY })
      void queryClient.invalidateQueries({ queryKey: USERS_KEY })
    },
  })
}

/** Remove users from a manual segment. */
export function useRemoveUsersFromSegment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      segmentId,
      principalIds,
    }: {
      segmentId: SegmentId
      principalIds: PrincipalId[]
    }) => removeUsersFromSegmentFn({ data: { segmentId, principalIds } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SEGMENTS_KEY })
      void queryClient.invalidateQueries({ queryKey: USERS_KEY })
    },
  })
}

/** Trigger re-evaluation of a dynamic segment. */
export function useEvaluateSegment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (segmentId: SegmentId) => evaluateSegmentFn({ data: { segmentId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SEGMENTS_KEY })
      void queryClient.invalidateQueries({ queryKey: USERS_KEY })
    },
  })
}

/** Trigger re-evaluation of all dynamic segments. */
export function useEvaluateAllSegments() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => evaluateAllSegmentsFn(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SEGMENTS_KEY })
      void queryClient.invalidateQueries({ queryKey: USERS_KEY })
    },
  })
}
