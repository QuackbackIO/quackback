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

/** A downgrade a billing manager has started, and the pages that resolve its issues. */
export interface PendingDowngradeLock {
  planId: string
  cleanupPaths: readonly string[]
}

/**
 * Which billing lock keeps a billing manager off this path, if any.
 *
 * An ended trial nobody has chosen for holds nothing during its grace period.
 * After it, admin waits on a plan choice: the plan picker and exports stay
 * open, and someone who chose Free keeps the pages that remove what is over
 * Free's limits, and only those, so the clean-up is not a way around the choice.
 *
 * Otherwise a pending downgrade keeps its billing manager to settings and the
 * feedback inbox, where resources over the new plan's limits are removed.
 */
export function adminBillingLock(input: {
  pathname: string
  pending: PendingDowngradeLock | null
  trialChoiceDueAt: Date | null
  now: Date
}): AdminBillingLock | null {
  const { pathname, pending } = input
  if (input.trialChoiceDueAt) {
    if (input.now.getTime() < input.trialChoiceDueAt.getTime()) return null
    if (isAdminPathAllowedDuringTrialChoice(pathname)) return null
    if (pending?.cleanupPaths.some((page) => isUnder(pathname, page))) return null
    return 'trial_choice'
  }
  if (pending) return isAdminPathAllowedDuringDowngradeLock(pathname) ? null : 'downgrade'
  return null
}
