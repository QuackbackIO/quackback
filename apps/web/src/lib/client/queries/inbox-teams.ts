import { queryOptions } from '@tanstack/react-query'
import type { TeamId } from '@quackback/ids'
import { listTeamsFn } from '@/lib/server/functions/teams'

export type InboxTeam = {
  id: TeamId
  name: string
  icon: string | null
  color: string
  memberCount: number
}

const INBOX_TEAMS_KEY = ['admin', 'inbox', 'teams'] as const

/** Shared (deduped) source of the per-team inbox roster. A queryOptions
 *  factory so the inbox route's loader can prefetch it under the exact key the
 *  nav sidebar reads. Lives outside the sidebar component because the loader
 *  runs from the route module, which every page loads eagerly. */
export function inboxTeamsQueryOptions() {
  return queryOptions({
    queryKey: INBOX_TEAMS_KEY,
    queryFn: async (): Promise<InboxTeam[]> => {
      const teams = await listTeamsFn()
      return teams.map((t) => ({ ...t, id: t.id as TeamId, color: t.color ?? 'gray' }))
    },
    staleTime: 60_000,
  })
}
