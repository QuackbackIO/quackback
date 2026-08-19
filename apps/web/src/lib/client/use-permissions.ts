/**
 * Client-side permission awareness: the resolved (assignment-derived) set the
 * admin shell's beforeLoad already computed, exposed as a hook. Render-only —
 * every mutation is still enforced server-side via requireAuth({ permission }),
 * so a stale value here can only hide or show affordances, never grant access.
 */
import { useRouteContext } from '@tanstack/react-router'
import { useMemo } from 'react'
import type { PermissionKey } from '@/lib/shared/permissions'

export function usePermissions(): ReadonlySet<PermissionKey> {
  const ctx = useRouteContext({ from: '/admin' }) as { permissions?: PermissionKey[] }
  return useMemo(() => new Set(ctx.permissions ?? []), [ctx.permissions])
}

export function useHasPermission(permission: PermissionKey): boolean {
  return usePermissions().has(permission)
}
