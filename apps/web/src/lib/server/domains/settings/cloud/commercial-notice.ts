import type { PlanNotice } from '../tier-limits.types'
import { PLAN_CATALOGUE, type CloudConfig } from './cloud.types'
import { daysUntil, isTrialEnded } from '@/lib/shared/billing/trial-state'

export function plansActionUrl(config: Pick<CloudConfig, 'enabled' | 'canUpgrade'>): string | null {
  return config.enabled && config.canUpgrade ? '/admin/settings/billing' : null
}

function planLabel(config: CloudConfig, trialPlanName?: string | null): string {
  if (trialPlanName) return trialPlanName
  return config.plan ? PLAN_CATALOGUE[config.plan].name : PLAN_CATALOGUE.pro.name
}

/**
 * Trial countdown derived from the control-plane-owned expiry timestamp. The
 * billing link is only for someone who can open billing.
 */
export function trialNotice(
  config: CloudConfig,
  now: Date = new Date(),
  options: { canManageBilling?: boolean } = {}
): PlanNotice | null {
  if (!config.enabled || !config.trialActive || !config.trialExpiresAt) return null
  const actionUrl = options.canManageBilling === false ? null : plansActionUrl(config)
  const daysLeft = daysUntil(config.trialExpiresAt, now)
  const urgent = daysLeft !== null && daysLeft <= 3
  return {
    label: `${planLabel(config)} trial`,
    trialPlan: planLabel(config),
    message: 'When it ends, upgrade to keep everything, or downgrade to Free.',
    expiresAt: config.trialExpiresAt,
    ...(actionUrl
      ? {
          actionUrl,
          actionLabel: urgent ? `Upgrade to ${planLabel(config)}` : 'Compare plans',
        }
      : {}),
  }
}

/**
 * The strip for an ended trial nobody has chosen a plan for. The workspace is
 * already running on Free limits, so it never asks for billing details: it
 * asks for a choice. Teammates who cannot manage billing get the same news
 * without a button they could not use.
 */
export function trialEndedNotice(
  config: CloudConfig,
  options: { trialPlanName?: string | null; now?: Date; canManageBilling?: boolean } = {}
): PlanNotice | null {
  if (!config.enabled || !config.plan) return null
  const now = options.now ?? new Date()
  const ended = isTrialEnded({
    plan: config.plan,
    trialActive: config.trialActive,
    trialExpiresAt: config.trialExpiresAt,
    status: config.subscriptionStatus,
    now,
  })
  if (!ended) return null
  const name = options.trialPlanName
  const label = name ? `${name} trial ended` : 'Trial ended'
  const base = { label, expiresAt: config.trialExpiresAt!, ended: true as const }
  if (options.canManageBilling === false) {
    return {
      ...base,
      message: 'Ask someone who manages billing to upgrade. Until then, Free limits apply.',
    }
  }
  const actionUrl = plansActionUrl(config)
  return {
    ...base,
    message: name
      ? `Upgrade to ${name} to keep everything, or downgrade to Free.`
      : 'Upgrade to a paid plan to keep everything, or downgrade to Free.',
    ...(actionUrl ? { actionUrl, actionLabel: 'Compare plans' } : {}),
  }
}
