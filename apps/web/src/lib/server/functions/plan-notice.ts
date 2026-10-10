import { createServerFn } from '@tanstack/react-start'
import type { PlanNotice } from '@/lib/server/domains/settings/tier-limits.types'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'

/** The plan notice, or null. Read by the admin layout to render the notice
 *  banner. Team-only: the notice can carry billing or maintenance details, so
 *  the RPC endpoint must not leak it to portal users or anonymous callers.
 *
 *  Two sources, in order. Self-host operator notices (config-file) win.
 *  Cloud workspaces ignore stored `tier_limits.notice`: commercial banners
 *  are derived from the signed billing projection so a leftover Free-trial
 *  strip cannot outrank a grant or paid plan. On an install with no cloud
 *  config the second source is disabled and returns null. */
export const getPlanNotice = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PlanNotice | null> => {
    const auth = await requireAuth({ permission: PERMISSIONS.MEMBER_VIEW })
    const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
    const { getCloudConfig } = await import('@/lib/server/domains/settings/cloud/cloud.service')
    const [limits, initial] = await Promise.all([getTierLimits(), getCloudConfig()])
    if (!initial.enabled && limits.notice) return limits.notice

    const { reportStarterTrialIfDue } = await import('@/lib/server/control-plane/starter-trial')
    await reportStarterTrialIfDue({ principalId: auth.principal.id })
    // Re-read after reporting: a starter retry can land the signed trial
    // projection before this returns, and the admin layout caches the result.
    const cloud = initial.enabled ? await getCloudConfig() : initial

    const { trialNotice, trialEndedNotice } =
      await import('@/lib/server/domains/settings/cloud/commercial-notice')
    const running = trialNotice(cloud)
    if (running) return running

    const ended = trialEndedNotice(cloud)
    if (!ended) return null

    try {
      const { fetchBillingCatalogue } = await import('@/lib/server/control-plane/client')
      const { PLAN_CATALOGUE, canonicalPlanId, isPlanId } =
        await import('@/lib/server/domains/settings/cloud/cloud.types')
      const catalogue = await fetchBillingCatalogue()
      const last = catalogue.lastTrialPlanId ? canonicalPlanId(catalogue.lastTrialPlanId) : null
      if (last && isPlanId(last) && last in PLAN_CATALOGUE) {
        return trialEndedNotice(cloud, { trialPlanName: PLAN_CATALOGUE[last].name })
      }
    } catch {
      /* catalogue is optional; ended copy falls back without the plan name */
    }
    return ended
  }
)
