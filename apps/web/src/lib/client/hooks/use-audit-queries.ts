/**
 * Audit log query hooks (read-only). Uses cursor pagination via
 * `useInfiniteQuery` for the timeline view.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { listAuditEventsPagedFn } from '@/lib/server/functions/audit'

export interface AuditFilters {
  principalId?: string
  action?: string
  actionPrefix?: string
  targetType?: string
  targetId?: string
  source?: 'web' | 'api' | 'integration' | 'system' | 'mcp'
  from?: string
  to?: string
}

export const auditKeys = {
  all: ['audit'] as const,
  list: (filters: AuditFilters) => [...auditKeys.all, 'list', filters] as const,
}

export function useAuditEventsInfinite(filters: AuditFilters, enabled = true) {
  return useInfiniteQuery({
    queryKey: auditKeys.list(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listAuditEventsPagedFn({ data: { ...filters, cursor: pageParam, limit: 50 } }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getNextPageParam: (last: any) => last?.nextCursor ?? undefined,
    enabled,
    staleTime: 30_000,
  })
}

export function useAuditEvents(filters: AuditFilters, enabled = true) {
  return useQuery({
    queryKey: [...auditKeys.list(filters), 'first'],
    queryFn: () => listAuditEventsPagedFn({ data: { ...filters, limit: 50 } }),
    enabled,
    staleTime: 30_000,
  })
}
