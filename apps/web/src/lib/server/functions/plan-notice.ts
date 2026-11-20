import { createServerFn } from '@tanstack/react-start'
import type { PlanNotice } from '@/lib/server/domains/settings/tier-limits.types'
import { assertDashboardScope, requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { ForbiddenError } from '@/lib/shared/errors'
import { isTeamMember } from '@/lib/shared/roles'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'plan-notice' })

/** The plan notice, or null. Read by the admin layout to render the notice
 *  banner. Any teammate on a dashboard session, never a portal user or an
 *  anonymous caller. The commercial strips carry only the plan, the date,
 *  plain copy and, for someone who manages billing, a link to billing; the
 *  free-form operator notice stays with teammates who can view members.
 *
 *  Two sources, in order. Self-host operator notices (config-file) win.
 *  Cloud workspaces ignore stored `tier_limits.notice`: commercial banners
 *  are derived from the signed billing projection so a leftover Free-trial
 *  strip cannot outrank a grant or paid plan. On an install with no cloud
 *  config the second source is disabled and returns null. */
export const getPlanNotice = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PlanNotice | null> => {
    const auth = await requireAuth()
    assertDashboardScope(auth)
    if (!isTeamMember(auth.principal.role)) {
      throw new ForbiddenError('FORBIDDEN', 'Access denied: Not a team member')
    }
    // The admin layout shows no notice when this fails, so a real failure
    // (settings or cloud config unreadable) is logged here rather than lost.
    try {
      return await readPlanNotice(auth)
    } catch (err) {
      log.warn({ err, principal_id: auth.principal.id }, 'plan notice read failed')
      throw err
    }
  }
)

async function readPlanNotice(
  auth: Awaited<ReturnType<typeof requireAuth>>
): Promise<PlanNotice | null> {
  const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
  const { getCloudConfig } = await import('@/lib/server/domains/settings/cloud/cloud.service')
  const [limits, initial] = await Promise.all([getTierLimits(), getCloudConfig()])
  if (!initial.enabled && limits.notice) {
    return auth.permissions.includes(PERMISSIONS.MEMBER_VIEW) ? limits.notice : null
  }

  const { reportStarterTrialIfDue } = await import('@/lib/server/control-plane/starter-trial')
  await reportStarterTrialIfDue({ principalId: auth.principal.id })
  // Re-read after reporting: a starter retry can land the signed trial
  // projection before this returns, and the admin layout caches the result.
  const cloud = initial.enabled ? await getCloudConfig() : initial

  const { trialNotice, trialEndedNotice } =
    await import('@/lib/server/domains/settings/cloud/commercial-notice')
  const canManageBilling = auth.permissions.includes(PERMISSIONS.BILLING_MANAGE)
  const running = trialNotice(cloud, new Date(), { canManageBilling })
  if (running) return running

  const ended = trialEndedNotice(cloud, { canManageBilling })
  if (!ended) return null

  try {
    const { fetchBillingCatalogue } = await import('@/lib/server/control-plane/client')
    const { PLAN_CATALOGUE, canonicalPlanId, isPlanId } =
      await import('@/lib/server/domains/settings/cloud/cloud.types')
    const catalogue = await fetchBillingCatalogue()
    const last = catalogue.lastTrialPlanId ? canonicalPlanId(catalogue.lastTrialPlanId) : null
    if (last && isPlanId(last) && last in PLAN_CATALOGUE) {
      return trialEndedNotice(cloud, {
        trialPlanName: PLAN_CATALOGUE[last].name,
        canManageBilling,
      })
    }
  } catch {
    /* catalogue is optional; ended copy falls back without the plan name */
  }
  return ended
}
