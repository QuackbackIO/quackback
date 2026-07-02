/**
 * Teams query hooks — `useTeams()`, `useTeam()`, `useTeamMembers()`.
 */
import { useQuery } from '@tanstack/react-query'
import type { TeamId } from '@quackback/ids'
import { listTeamsFn, getTeamFn, listTeamMembersFn } from '@/lib/server/functions/teams'

export const teamsKeys = {
  all: ['teams'] as const,
  lists: () => [...teamsKeys.all, 'list'] as const,
  list: (filters: { includeArchived?: boolean }) => [...teamsKeys.lists(), filters] as const,
  detail: (id: TeamId) => [...teamsKeys.all, 'detail', id] as const,
  members: (id: TeamId) => [...teamsKeys.all, 'members', id] as const,
}

export function useTeams(opts: { includeArchived?: boolean; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: teamsKeys.list({ includeArchived: opts.includeArchived }),
    queryFn: () => listTeamsFn({ data: { includeArchived: opts.includeArchived } }),
    enabled: opts.enabled ?? true,
    staleTime: 60_000,
  })
}

export function useTeam(teamId: TeamId | null | undefined) {
  return useQuery({
    queryKey: teamId ? teamsKeys.detail(teamId) : ['teams', 'detail', 'none'],
    queryFn: () => getTeamFn({ data: { teamId: teamId! } }),
    enabled: !!teamId,
    staleTime: 60_000,
  })
}

export function useTeamMembers(teamId: TeamId | null | undefined) {
  return useQuery({
    queryKey: teamId ? teamsKeys.members(teamId) : ['teams', 'members', 'none'],
    queryFn: () => listTeamMembersFn({ data: { teamId: teamId! } }),
    enabled: !!teamId,
    staleTime: 30_000,
  })
}
