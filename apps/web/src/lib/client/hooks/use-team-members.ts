import { useQuery } from '@tanstack/react-query'
import { fetchTeamMembers } from '@/lib/server/functions/admin'

/**
 * The workspace's team members (assignees), shared by the assignee control, the
 * bulk-action bar, and the macro editor so they read one cache entry. 60s stale:
 * the roster rarely changes within a session.
 */
export function useTeamMembers(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'team-members'],
    queryFn: () => fetchTeamMembers(),
    staleTime: 60_000,
    enabled: options?.enabled,
  })
}
