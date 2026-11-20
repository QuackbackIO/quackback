import { useRouteContext } from '@tanstack/react-router'
import {
  presetForLegacyRole,
  SYSTEM_ROLE_PERMISSIONS,
  type PermissionKey,
} from '@/lib/shared/permissions'
import { canOpenSettingsPage, type GatedSettingsPage } from '@/lib/shared/settings-page-access'

/**
 * Pure resolution: does the legacy `principal.role` (admin/member/...) carry
 * the given permission, via its preset's key set? Split out from the hook so
 * the mapping is unit-testable without mounting a router context.
 *
 * This is a coarse, client-only convenience check for gating UI affordances
 * (e.g. showing the Copilot tab) — the server independently enforces every
 * permission on its own routes/fns, so a false positive here can never grant
 * real access, only (at worst) show an affordance the server then refuses.
 */
export function resolvePermission(role: string | null | undefined, key: PermissionKey): boolean {
  if (!role) return false
  const preset = presetForLegacyRole(role)
  if (!preset) return false
  return SYSTEM_ROLE_PERMISSIONS[preset].includes(key)
}

/**
 * Client-side permission check from the admin route's `principal.role`
 * (routes/admin.tsx beforeLoad). See {@link resolvePermission} for the actual
 * mapping and why this is UX-only. Selects the answer, so the caller renders
 * again only when it changes.
 */
export function usePermission(key: PermissionKey): boolean {
  return useRouteContext({
    from: '/admin',
    select: (context) => permissionFromRouteContext(context, key),
  })
}

/**
 * Whether the viewer can open a settings page (SETTINGS_PAGE_ACCESS), so a
 * link to it shows only to someone the page opens for.
 */
export function useCanOpenSettingsPage(path: GatedSettingsPage): boolean {
  return useRouteContext({
    from: '/admin',
    select: (context) => {
      const { principal, permissions } = (context ?? {}) as {
        principal?: { role: string } | null
        permissions?: PermissionKey[]
      }
      const preset = principal?.role ? presetForLegacyRole(principal.role) : null
      return canOpenSettingsPage(
        permissions ?? (preset ? SYSTEM_ROLE_PERMISSIONS[preset] : undefined),
        path
      )
    },
  })
}

/**
 * The answer {@link usePermission} gives, from an `/admin` route context. For a
 * `useRouteContext` select: beforeLoad hands back a fresh context on every
 * navigation, and selecting the answer keeps a component from re-rendering
 * when it has not changed.
 */
function permissionFromRouteContext(context: unknown, key: PermissionKey): boolean {
  const { principal, permissions } = (context ?? {}) as {
    principal?: { role: string } | null
    permissions?: PermissionKey[]
  }
  if (permissions) return permissions.includes(key)
  return resolvePermission(principal?.role, key)
}
