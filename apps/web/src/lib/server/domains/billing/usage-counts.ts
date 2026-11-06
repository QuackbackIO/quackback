/**
 * Current-usage counters for the plan's finite quotas, keyed by tier-limit
 * name so they line up with `getTierLimits()` and `planDowngradeIssues()`.
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
  and,
  eq,
  isNull,
  sql,
  posts,
  boards,
  roles,
  statusComponents,
  emailSendingDomains,
  channelAccounts,
  statusSubscriptions,
} from '@/lib/server/db'
import { getHelpCenterConfig } from '@/lib/server/domains/settings/settings.service'
import { DEFAULT_HELP_CENTER_CONFIG } from '@/lib/server/domains/settings/settings.types'
import { NotFoundError } from '@/lib/shared/errors'
import { aiTokensThisWindow } from '@/lib/server/domains/ai/ai-budget'
import { countSeatUsage } from '@/lib/server/domains/principals/seat-usage'
import { emailsSentThisMonth } from '@/lib/server/email/email-budget'
import { apiRequestsThisMonth } from '@/lib/server/domains/api/monthly-usage'
import { planDowngradeIssues } from '@/lib/shared/billing/plan-downgrade'
import { notTestPrincipal } from '@/lib/server/test-data'
import {
  canonicalPlanId,
  isPlanId,
  type PlanId,
} from '@/lib/server/domains/settings/cloud/cloud.types'

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
    inboundRow,
    subscriberRow,
    helpCenter,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(boards)
      .where(isNull(boards.deletedAt)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(posts)
      .where(and(isNull(posts.deletedAt), notTestPrincipal(posts.principalId))),
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
    aiTokensThisWindow(),
    emailsSentThisMonth(),
    apiRequestsThisMonth(),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(channelAccounts)
      .where(
        and(
          eq(channelAccounts.role, 'inbound'),
          eq(channelAccounts.channel, 'email'),
          isNull(channelAccounts.deletedAt)
        )
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(statusSubscriptions)
      .where(isNull(statusSubscriptions.unsubscribedAt)),
    // Fresh, not cached: this count can decide a downgrade, and another
    // process may have enabled a language since this one cached settings.
    // A workspace without a settings row only has the default language.
    getHelpCenterConfig('fresh').catch((error: unknown) => {
      if (error instanceof NotFoundError) return DEFAULT_HELP_CENTER_CONFIG
      throw error
    }),
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
    maxInboundEmailAddresses: inboundRow[0]?.count ?? 0,
    // The default language counts toward the plan's language cap.
    maxHelpCenterLocales: 1 + helpCenter.locales.additional.length,
    maxStatusSubscribers: subscriberRow[0]?.count ?? 0,
  }
}

/** Throws when current usage would not fit `planId`'s numeric caps. */
export async function assertFitsPlan(planId: string): Promise<void> {
  const id = parseTargetPlanId(planId)
  if (!id) throw new Error('invalid')
  const used = await loadUsageCounts()
  if (planDowngradeIssues(used, id).length === 0) return
  throw new Error(id === 'free' ? 'over_free_limits' : 'over_plan_limits')
}

/** Throws `over_free_limits` when current usage would not fit the free plan. */
export async function assertFitsFreePlan(): Promise<void> {
  await assertFitsPlan('free')
}

export function parseTargetPlanId(value: string): PlanId | null {
  const planId = canonicalPlanId(value)
  return isPlanId(planId) ? planId : null
}
