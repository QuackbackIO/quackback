import { useQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'

/**
 * The boards, tags and statuses an admin page's filters and pickers offer.
 * Each is read only by a viewer holding the permission its server function
 * requires (board.manage, tag.view, status.view); for anyone else the list is
 * empty rather than a request the server refuses. A route loader warms each
 * under the same permission. Admin pages only, as they read the admin route's
 * permissions.
 */
export function useAdminBoards() {
  return useQuery({ ...adminQueries.boards(), enabled: usePermission(PERMISSIONS.BOARD_MANAGE) })
}

export function useAdminTags() {
  return useQuery({ ...adminQueries.tags(), enabled: usePermission(PERMISSIONS.TAG_VIEW) })
}

/**
 * The team members for an admin page, read only by a viewer holding
 * member.view (what fetchTeamMembers requires): for anyone else there are no
 * teammates to pick, rather than a request the server refuses. The same cache
 * entry as teamMembersQuery, fresh for 60s like it.
 */
export function useAdminTeamMembers() {
  return useQuery({
    ...adminQueries.teamMembers(),
    staleTime: 60_000,
    enabled: usePermission(PERMISSIONS.MEMBER_VIEW),
  })
}

export function useAdminStatuses() {
  return useQuery({ ...adminQueries.statuses(), enabled: usePermission(PERMISSIONS.STATUS_VIEW) })
}
