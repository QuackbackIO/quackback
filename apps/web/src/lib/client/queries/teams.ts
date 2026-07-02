/**
 * Team query factory — list / detail / members. Mirrors `inboxQueries`.
 */
import { queryOptions } from '@tanstack/react-query'
import type { TeamId } from '@quackback/ids'
import { listTeamsFn, getTeamFn, listTeamMembersFn } from '@/lib/server/functions/teams'

const STALE = 30_000

export const teamQueries = {
  all: ['teams'] as const,
  list: (filters: { includeArchived?: boolean } = {}) =>
    queryOptions({
      queryKey: ['teams', 'list', filters] as const,
      queryFn: () => listTeamsFn({ data: { includeArchived: filters.includeArchived } }),
      staleTime: STALE,
    }),
  detail: (teamId: TeamId) =>
    queryOptions({
      queryKey: ['teams', 'detail', teamId] as const,
      queryFn: () => getTeamFn({ data: { teamId } }),
      staleTime: STALE,
    }),
  members: (teamId: TeamId) =>
    queryOptions({
      queryKey: ['teams', 'members', teamId] as const,
      queryFn: () => listTeamMembersFn({ data: { teamId } }),
      staleTime: STALE,
    }),
}
