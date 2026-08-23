import type { PlanNotice } from '../tier-limits.types'
import { PLAN_CATALOGUE, type CloudConfig } from './cloud.types'
import { daysUntil, isTrialEnded } from '@/lib/shared/billing/trial-state'

export const IN_APP_PLANS_PATH = '/admin/settings/billing'

export function plansActionUrl(config: Pick<CloudConfig, 'enabled' | 'canUpgrade'>): string | null {
  return config.enabled && config.canUpgrade ? IN_APP_PLANS_PATH : null
}

function planLabel(config: CloudConfig, trialPlanName?: string | null): string {
  if (trialPlanName) return trialPlanName
  return config.plan ? PLAN_CATALOGUE[config.plan].name : PLAN_CATALOGUE.pro.name
}

/** Trial countdown derived from the control-plane-owned expiry timestamp. */
export function trialNotice(config: CloudConfig, now: Date = new Date()): PlanNotice | null {
  if (!config.enabled || !config.trialActive || !config.trialExpiresAt) return null
  const actionUrl = plansActionUrl(config)
  const daysLeft = daysUntil(config.trialExpiresAt, now)
  const urgent = daysLeft !== null && daysLeft <= 3
  return {
    label: `${planLabel(config)} trial`,
    message: 'When this ends you will continue on Free. Everything you have built stays.',
    expiresAt: config.trialExpiresAt,
    ...(actionUrl
      ? {
          actionUrl,
          actionLabel: urgent ? `Continue with ${planLabel(config)}` : 'See plans',
        }
      : {}),
  }
}

export function trialEndedNotice(
  config: CloudConfig,
  options: { trialPlanName?: string | null; now?: Date } = {}
): PlanNotice | null {
  if (!config.enabled || !config.plan) return null
  const now = options.now ?? new Date()
  if (
    !isTrialEnded({
      plan: config.plan,
      trialActive: config.trialActive,
      trialExpiresAt: config.trialExpiresAt,
      status: config.subscriptionStatus,
      now,
    })
  ) {
    return null
  }
  const actionUrl = plansActionUrl(config)
  const name = options.trialPlanName
  const ended = formatNoticeDate(config.trialExpiresAt!)
  return {
    label: name ? `${name} trial` : 'Trial',
    message: name
      ? `Your ${name} trial ended ${ended}. You are on Free now, and everything you built is still here.`
      : `Your trial ended ${ended}. You are on Free now, and everything you built is still here.`,
    expiresAt: config.trialExpiresAt!,
    dismissible: true,
    ...(actionUrl ? { actionUrl, actionLabel: name ? `Continue with ${name}` : 'See plans' } : {}),
  }
}

function formatNoticeDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
