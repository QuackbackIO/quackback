import type { PlanNotice } from '../tier-limits.types'
import { PLAN_CATALOGUE, type CloudConfig } from './cloud.types'

export const IN_APP_PLANS_PATH = '/admin/settings/billing'

export function plansActionUrl(config: Pick<CloudConfig, 'enabled' | 'canUpgrade'>): string | null {
  return config.enabled && config.canUpgrade ? IN_APP_PLANS_PATH : null
}

/** Trial countdown derived from the control-plane-owned expiry timestamp. */
export function trialNotice(config: CloudConfig): PlanNotice | null {
  if (!config.enabled || !config.trialActive || !config.trialExpiresAt) return null
  const actionUrl = plansActionUrl(config)
  return {
    label: `${PLAN_CATALOGUE.pro.name} trial`,
    message: 'Your workspace moves to the Free plan when this ends. Nothing is deleted.',
    expiresAt: config.trialExpiresAt,
    ...(actionUrl ? { actionUrl, actionLabel: 'See plans' } : {}),
  }
}
