/**
 * In-memory route-level permission gate for admin child routes.
 *
 * The parent `/admin` route's beforeLoad already resolved the caller's
 * assignment-derived permission set (via requireWorkspaceRole) and placed it on
 * the router context. Child routes therefore gate on that set in memory instead
 * of paying a per-navigation server-fn round trip that re-runs the same
 * session/settings/principal/permissions resolution.
 *
 * The thrown redirect is identical to the one requireWorkspaceRole raises on a
 * permission miss, so the user-visible behavior for an under-privileged
 * teammate is unchanged: bounced to the portal sign-in dialog with a
 * `callbackUrl=/admin` and `error=not_team_member`.
 */
import { redirect } from '@tanstack/react-router'
import { buildSigninRedirect } from './auth-prompt'
import type { PermissionKey } from './permissions'

/**
 * Assert the caller (per the parent `/admin` context) holds `permission`.
 *
 * `permissions` is the array the parent route's beforeLoad returned. It is
 * optional/undefined only for the public admin paths (`/admin/login`,
 * `/admin/signup`) that never mount permission-gated child routes, so a missing
 * set is treated as "no permission" and redirected — matching requireWorkspaceRole.
 */
export function assertRoutePermission(
  permissions: readonly string[] | undefined,
  permission: PermissionKey
): void {
  if (!permissions?.includes(permission)) {
    throw redirect(buildSigninRedirect('/admin', { error: 'not_team_member' }))
  }
}
