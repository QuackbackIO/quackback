/**
 * The permission an admin page's main read needs, so the page, its route
 * loader and the sidebar agree on who can open it. A viewer without it sees
 * the no-access state on the page and no item in the sidebar, rather than an
 * error from a read the server refuses. Any one of a page's keys opens it.
 *
 * Each list mirrors the server check on the page's first read; the server
 * still enforces every read on its own.
 */
import { PERMISSIONS, type PermissionKey } from './permissions'

export const ADMIN_PAGE_ACCESS = {
  // fetchInboxPosts
  '/admin/feedback': [PERMISSIONS.POST_VIEW_PRIVATE],
  // listChangelogsFn
  '/admin/changelog': [PERMISSIONS.CHANGELOG_VIEW_DRAFT],
  // listCategoriesFn and listArticlesFn
  '/admin/help-center': [PERMISSIONS.HELP_CENTER_MANAGE],
  // The Status admin opens on incidents (publish) or on services (manage).
  '/admin/status': [PERMISSIONS.STATUS_PAGE_PUBLISH, PERMISSIONS.STATUS_PAGE_MANAGE],
  // getAnalyticsData
  '/admin/analytics': [PERMISSIONS.ANALYTICS_VIEW],
  // listPortalUsersFn
  '/admin/users': [PERMISSIONS.PEOPLE_VIEW],
} as const satisfies Record<string, readonly PermissionKey[]>

export type GatedAdminPage = keyof typeof ADMIN_PAGE_ACCESS

/** Whether a viewer holding `permissions` can open the admin page at `href`. */
export function canOpenAdminPage(
  permissions: ReadonlySet<string> | readonly string[],
  href: string
): boolean {
  const needs: readonly PermissionKey[] | undefined = ADMIN_PAGE_ACCESS[href as GatedAdminPage]
  if (!needs) return true
  const holds = (key: string) =>
    Array.isArray(permissions)
      ? permissions.includes(key)
      : (permissions as ReadonlySet<string>).has(key)
  return needs.some(holds)
}
