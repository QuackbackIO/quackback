/**
 * Admin paths a billing manager may visit while a quota-blocked downgrade
 * is pending. Settings is where boards, seats, roles, status components and
 * sending domains are deleted; posts live on the feedback inbox.
 */
export function isAdminPathAllowedDuringDowngradeLock(pathname: string): boolean {
  if (pathname === '/admin/login' || pathname === '/admin/signup') return true
  if (pathname === '/admin/settings' || pathname.startsWith('/admin/settings/')) return true
  if (pathname === '/admin/feedback' || pathname.startsWith('/admin/feedback/')) return true
  return false
}
