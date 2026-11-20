/**
 * The tabs of Settings > Access & Security and what each needs. The page
 * opens to auth.manage; Portal access also reads and saves the portal config
 * (settings.manage) and Audit log reads the audit feed (audit.view), so each
 * of those tabs shows only to a viewer who holds its permission too.
 */
import { PERMISSIONS, type PermissionKey } from './permissions'

export const AUTH_TABS = ['portal-access', 'sign-in', 'audit-log'] as const
export type AuthTab = (typeof AUTH_TABS)[number]

const TAB_PERMISSIONS: Record<AuthTab, readonly PermissionKey[]> = {
  'portal-access': [PERMISSIONS.AUTH_MANAGE, PERMISSIONS.SETTINGS_MANAGE],
  'sign-in': [PERMISSIONS.AUTH_MANAGE],
  'audit-log': [PERMISSIONS.AUTH_MANAGE, PERMISSIONS.AUDIT_VIEW],
}

/** The permissions a viewer needs, all of them, to have `tab`. */
export function authTabPermissions(tab: AuthTab): readonly PermissionKey[] {
  return TAB_PERMISSIONS[tab]
}

/** The tabs this viewer has, in order. */
export function authTabsFor(permissions: readonly string[] | undefined): AuthTab[] {
  return AUTH_TABS.filter((tab) =>
    TAB_PERMISSIONS[tab].every((permission) => permissions?.includes(permission) ?? false)
  )
}

/** The tab asked for when the viewer has it; otherwise their first. */
export function resolveAuthTab(requested: AuthTab | undefined, tabs: readonly AuthTab[]): AuthTab {
  if (requested && tabs.includes(requested)) return requested
  return tabs[0] ?? 'sign-in'
}
