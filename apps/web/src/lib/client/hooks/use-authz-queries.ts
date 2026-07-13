/**
 * Authz / permissions client hook.
 *
 * Caches the actor's full permission set workspace-wide for the session;
 * consumed by `<PermissionGate />`, sidebar nav filtering, and per-control
 * disable logic.
 */
import { useQuery } from '@tanstack/react-query'
import type { TeamId } from '@quackback/ids'
import { getMyPermissionsFn } from '@/lib/server/functions/authz'
import type { MyPermissionsResult } from '@/lib/server/functions/authz'
import type { PermissionKey } from '@/lib/server/domains/authz'

export const authzKeys = {
  all: ['authz'] as const,
  me: () => [...authzKeys.all, 'me'] as const,
}

export function useMyPermissions(enabled = true): ReturnType<typeof useQuery<MyPermissionsResult>> {
  return useQuery({
    queryKey: authzKeys.me(),
    queryFn: () => getMyPermissionsFn(),
    enabled,
    staleTime: 60_000,
  })
}

/**
 * Convenience selector — returns true if the actor holds `permission` either
 * workspace-wide or via any team-scoped grant.
 *
 * Falls back to `false` while the underlying query is loading; UI should
 * skeleton/disable rather than render. Pass `loadingFallback` to override.
 */
export function useHasPermission(
  permission: PermissionKey,
  options: { teamId?: TeamId | null; loadingFallback?: boolean } = {}
): boolean {
  const { data, isLoading } = useMyPermissions()
  if (isLoading) return options.loadingFallback ?? false
  if (!data) return false
  if (data.workspacePermissions.includes(permission)) return true
  if (options.teamId) {
    const team = data.teamPermissions.find((t) => t.teamId === options.teamId)
    return !!team && team.permissions.includes(permission)
  }
  // Permission may be granted by any team scope.
  return data.teamPermissions.some((t) => t.permissions.includes(permission))
}
