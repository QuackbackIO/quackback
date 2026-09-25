/**
 * Client-side permission awareness: the resolved (assignment-derived) set the
 * admin shell's beforeLoad already computed, exposed as a hook. Render-only —
 * every mutation is still enforced server-side via requireAuth({ permission }),
 * so a stale value here can only hide or show affordances, never grant access.
 *
 * Both hooks select from the route context: beforeLoad hands back a fresh
 * context object on every navigation, while the permission list inside it is
 * the same one until the guard is asked again.
 */
import { useRouteContext } from '@tanstack/react-router'
import { useMemo } from 'react'
import type { PermissionKey } from '@/lib/shared/permissions'

function permissionsOf(context: unknown): PermissionKey[] | undefined {
  return (context as { permissions?: PermissionKey[] }).permissions
}

export function usePermissions(): ReadonlySet<PermissionKey> {
  const permissions = useRouteContext({ from: '/admin', select: permissionsOf })
  return useMemo(() => new Set(permissions ?? []), [permissions])
}

export function useHasPermission(permission: PermissionKey): boolean {
  return useRouteContext({
    from: '/admin',
    select: (context) => permissionsOf(context)?.includes(permission) ?? false,
  })
}
