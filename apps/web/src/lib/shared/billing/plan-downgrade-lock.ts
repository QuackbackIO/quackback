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

/**
 * Admin paths a billing manager may visit once an ended trial's grace period
 * is over and nobody has chosen a plan: the plan picker and its checkout, and
 * Imports & exports, so someone deciding not to pay can still take their data.
 */
export function isAdminPathAllowedDuringTrialChoice(pathname: string): boolean {
  if (pathname === '/admin/login' || pathname === '/admin/signup') return true
  return (
    isUnder(pathname, '/admin/settings/billing') || isUnder(pathname, '/admin/settings/imports')
  )
}

export type AdminBillingLock = 'downgrade' | 'trial_choice'

/**
 * Which billing lock keeps a billing manager off this path, if any.
 *
 * A pending downgrade wins. It is a choice already made, and its pages are
 * where the resources over the new plan's limits get removed, so it leaves
 * more of admin open than the trial choice does.
 */
export function adminBillingLock(input: {
  pathname: string
  pendingDowngrade: boolean
  trialChoiceDueAt: Date | null
  now: Date
}): AdminBillingLock | null {
  if (input.pendingDowngrade) {
    return isAdminPathAllowedDuringDowngradeLock(input.pathname) ? null : 'downgrade'
  }
  if (input.trialChoiceDueAt && input.now.getTime() >= input.trialChoiceDueAt.getTime()) {
    return isAdminPathAllowedDuringTrialChoice(input.pathname) ? null : 'trial_choice'
  }
  return null
}
