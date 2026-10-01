/** The AI & Automation pages, which live under settings but are product surfaces. */
const BLOCKED_SETTINGS_PAGES = [
  '/admin/settings/agent',
  '/admin/settings/copilot',
  '/admin/settings/skills',
  '/admin/settings/connectors',
  '/admin/settings/workflows',
]

const isUnder = (pathname: string, page: string) =>
  pathname === page || pathname.startsWith(`${page}/`)

/**
 * Admin paths a billing manager may visit while a quota-blocked downgrade
 * is pending. Settings is where boards, seats, roles, status components and
 * sending domains are deleted; posts live on the feedback inbox.
 */
export function isAdminPathAllowedDuringDowngradeLock(pathname: string): boolean {
  if (pathname === '/admin/login' || pathname === '/admin/signup') return true
  if (BLOCKED_SETTINGS_PAGES.some((page) => isUnder(pathname, page))) return false
  if (pathname === '/admin/settings' || pathname.startsWith('/admin/settings/')) return true
  if (pathname === '/admin/feedback' || pathname.startsWith('/admin/feedback/')) return true
  return false
}
