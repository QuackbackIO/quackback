import { useRouteContext } from '@tanstack/react-router'
import {
  presetForLegacyRole,
  SYSTEM_ROLE_PERMISSIONS,
  type PermissionKey,
} from '@/lib/shared/permissions'

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
 * mapping and why this is UX-only.
 */
export function usePermission(key: PermissionKey): boolean {
  const { principal } = useRouteContext({ from: '/admin' }) as {
    principal?: { role: string } | null
  }
  return resolvePermission(principal?.role, key)
}
