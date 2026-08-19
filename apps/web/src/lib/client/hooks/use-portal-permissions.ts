/**
 * usePortalPermissions: the portal counterpart to the admin-side
 * usePermission hook. The permission set is resolved server-side (the
 * _portal loader calls getMyPortalPermissionsFn once per request) and
 * provided here via context, so it is SSR-consistent — no flash of team UI —
 * and correct for custom roles, which a client-side preset expansion is not.
 *
 * Render-only: this decides what UI to show. The server independently
 * enforces every mutation via requireAuth({ permission }).
 */
import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react'
import type { PermissionKey } from '@/lib/shared/permissions'

const EMPTY_PERMISSIONS: ReadonlySet<string> = new Set()

// Default is the empty set so the hook is safe anywhere: outside the portal
// tree (or on the access-gate branch, which mounts no provider) every check
// simply reads false.
const PortalPermissionsContext = createContext<ReadonlySet<string>>(EMPTY_PERMISSIONS)

export function PortalPermissionsProvider(props: {
  permissionKeys: ReadonlyArray<string>
  children: ReactNode
}): React.ReactElement {
  const permissions = useMemo<ReadonlySet<string>>(
    () => (props.permissionKeys.length > 0 ? new Set(props.permissionKeys) : EMPTY_PERMISSIONS),
    [props.permissionKeys]
  )

  return createElement(PortalPermissionsContext.Provider, { value: permissions }, props.children)
}

export interface PortalPermissions {
  /** The actor's resolved permission keys; empty for end users and visitors. */
  permissions: ReadonlySet<string>
  /** True when the actor holds the given permission key. */
  can: (key: PermissionKey) => boolean
  /** True when the actor holds at least one of the given keys. */
  hasAny: (...keys: PermissionKey[]) => boolean
}

export function usePortalPermissions(): PortalPermissions {
  const permissions = useContext(PortalPermissionsContext)
  return useMemo(
    () => ({
      permissions,
      can: (key: PermissionKey) => permissions.has(key),
      hasAny: (...keys: PermissionKey[]) => keys.some((key) => permissions.has(key)),
    }),
    [permissions]
  )
}
