import { queryOptions } from '@tanstack/react-query'
import { fetchPortalInvitesFn } from '@/lib/server/functions/portal-invites'

/**
 * One invitation row as returned by `fetchPortalInvitesFn` and rendered by
 * the InviteRow component.
 */
export interface PortalInvite {
  id: string
  email: string
  status: string | null
  createdAt: string
  lastSentAt: string | null
}

export const PORTAL_INVITES_QUERY_KEY = ['portal', 'invites'] as const

/** Portal invitations (admin only: the server fn requires settings.manage). */
export const portalInvitesQueryOptions = () =>
  queryOptions<PortalInvite[]>({
    queryKey: PORTAL_INVITES_QUERY_KEY,
    queryFn: () => fetchPortalInvitesFn(),
    staleTime: 30 * 1000,
  })
