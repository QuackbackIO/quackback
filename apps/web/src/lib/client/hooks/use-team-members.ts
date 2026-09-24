import { queryOptions, useQuery } from '@tanstack/react-query'
import { fetchTeamMembers } from '@/lib/server/functions/admin'

/**
 * The workspace's team members (assignees), shared by the assignee control, the
 * bulk-action bar, and the macro editor so they read one cache entry. 60s stale:
 * the roster rarely changes within a session. The inbox's conversation request
 * seeds it (see conversation-panel-cache.ts).
 */
export function teamMembersQuery() {
  return queryOptions({
    queryKey: ['admin', 'team-members'] as const,
    queryFn: () => fetchTeamMembers(),
    staleTime: 60_000,
  })
}

export function useTeamMembers(options?: { enabled?: boolean }) {
  return useQuery({ ...teamMembersQuery(), enabled: options?.enabled })
}
