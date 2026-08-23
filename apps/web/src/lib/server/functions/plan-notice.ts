import { createServerFn } from '@tanstack/react-start'
import type { PlanNotice } from '@/lib/server/domains/settings/tier-limits.types'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'

/** The plan notice, or null. Read by the admin layout to render the notice
 *  banner. Team-only: the notice can carry billing or maintenance details, so
 *  the RPC endpoint must not leak it to portal users or anonymous callers.
 *
 *  Two sources, in order. An operator-set notice wins outright: someone chose
 *  those words for this workspace and a derived one must not talk over them.
 *  Otherwise a workspace running a trial gets its countdown here, derived from
 *  the trial rather than stored anywhere, so it appears and disappears with
 *  the trial itself and there is nothing left behind to clear.
 *
 *  Both reads are of already-cached workspace state, and on an install with no
 *  cloud config the second one resolves to "disabled" and returns null without
 *  looking at anything else. */
export const getPlanNotice = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PlanNotice | null> => {
    const auth = await requireAuth({ permission: PERMISSIONS.MEMBER_VIEW })
    const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
    const limits = await getTierLimits()
    if (limits.notice) return limits.notice

    const { reportStarterTrialIfDue } = await import('@/lib/server/control-plane/starter-trial')
    await reportStarterTrialIfDue({ principalId: auth.principal.id })

    const { getCloudConfig } = await import('@/lib/server/domains/settings/cloud/cloud.service')
    const { trialNotice, trialEndedNotice } =
      await import('@/lib/server/domains/settings/cloud/commercial-notice')
    const cloud = await getCloudConfig()
    const running = trialNotice(cloud)
    if (running) return running

    let trialPlanName: string | null = null
    try {
      const { fetchBillingCatalogue } = await import('@/lib/server/control-plane/client')
      const { PLAN_CATALOGUE } = await import('@/lib/server/domains/settings/cloud/cloud.types')
      const catalogue = await fetchBillingCatalogue()
      const last = catalogue.lastTrialPlanId
      if (last && last in PLAN_CATALOGUE) trialPlanName = PLAN_CATALOGUE[last].name
    } catch {
      /* catalogue is optional; ended copy falls back to "Your trial ended" */
    }
    return trialEndedNotice(cloud, { trialPlanName })
  }
)
