/**
 * Current-usage counters for the plan's finite quotas, keyed by tier-limit
 * name so they line up with `getTierLimits()` and `freeDowngradeIssues()`.
 *
 * Server-only: this talks to the database directly. It deliberately lives
 * outside `lib/server/functions/billing.ts` — anything declared at module
 * scope in a server-function file (rather than inside a `.handler()`) is
 * kept in the client half of that module by the Start compiler, and its
 * `import('@/lib/server/db')` was pulling the whole database/auth graph into
 * the browser's dev module graph (import-protection errors, a Vite
 * dependency re-optimisation and forced reload mid-navigation).
 */

import {
  db,
  eq,
  isNull,
  sql,
  posts,
  boards,
  roles,
  statusComponents,
  emailSendingDomains,
} from '@/lib/server/db'
import { aiTokensThisMonth } from '@/lib/server/domains/ai/usage-counter'
import { countSeatUsage } from '@/lib/server/domains/principals/seat-usage'
import { emailsSentThisMonth } from '@/lib/server/email/email-budget'
import { apiRequestsThisMonth } from '@/lib/server/domains/api/monthly-usage'
import { freeDowngradeIssues } from '@/lib/shared/billing/free-downgrade'

export async function loadUsageCounts(): Promise<Record<string, number>> {
  const [
    boardRow,
    postRow,
    seats,
    statusRow,
    roleRow,
    domainRow,
    aiTokens,
    emailsSent,
    apiRequests,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(boards)
      .where(isNull(boards.deletedAt)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(posts)
      .where(isNull(posts.deletedAt)),
    countSeatUsage(),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(statusComponents)
      .where(isNull(statusComponents.deletedAt)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(roles)
      .where(eq(roles.isSystem, false)),
    db.select({ count: sql<number>`count(*)::int` }).from(emailSendingDomains),
    aiTokensThisMonth(),
    emailsSentThisMonth(),
    apiRequestsThisMonth(),
  ])
  return {
    maxBoards: boardRow[0]?.count ?? 0,
    maxPosts: postRow[0]?.count ?? 0,
    maxTeamSeats: seats.used,
    maxStatusComponents: statusRow[0]?.count ?? 0,
    maxCustomRoles: roleRow[0]?.count ?? 0,
    maxSendingDomains: domainRow[0]?.count ?? 0,
    aiTokensPerMonth: aiTokens,
    emailsPerMonth: emailsSent,
    apiRequestsPerMonth: apiRequests,
  }
}

/** Throws `over_free_limits` when current usage would not fit the free plan. */
export async function assertFitsFreePlan(): Promise<void> {
  const used = await loadUsageCounts()
  if (freeDowngradeIssues(used).length > 0) throw new Error('over_free_limits')
}
