import type { PlanNotice } from '../tier-limits.types'
import { PLAN_CATALOGUE, type CloudConfig } from './cloud.types'
import { daysUntil, isTrialEnded } from '@/lib/shared/billing/trial-state'

export function plansActionUrl(config: Pick<CloudConfig, 'enabled' | 'canUpgrade'>): string | null {
  return config.enabled && config.canUpgrade ? '/admin/settings/billing' : null
}

function planLabel(config: CloudConfig, trialPlanName?: string | null): string {
  if (trialPlanName) return trialPlanName
  return config.plan ? PLAN_CATALOGUE[config.plan].name : PLAN_CATALOGUE.growth.name
}

/** Trial countdown derived from the control-plane-owned expiry timestamp. */
export function trialNotice(config: CloudConfig, now: Date = new Date()): PlanNotice | null {
  if (!config.enabled || !config.trialActive || !config.trialExpiresAt) return null
  const actionUrl = plansActionUrl(config)
  const daysLeft = daysUntil(config.trialExpiresAt, now)
  const urgent = daysLeft !== null && daysLeft <= 3
  return {
    label: `${planLabel(config)} trial`,
    message: 'When this ends, pick a paid plan or switch to Free from billing.',
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
  const product = name ?? 'Quackback'
  return {
    label: name ? `${name} trial ended` : 'Trial ended',
    message: `Your trial has come to an end. Please update your billing information to continue using ${product}.`,
    expiresAt: config.trialExpiresAt!,
    ended: true,
    ...(actionUrl ? { actionUrl, actionLabel: 'Update billing' } : {}),
  }
}
