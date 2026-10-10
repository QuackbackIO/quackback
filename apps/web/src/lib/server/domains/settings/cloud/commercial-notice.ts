import type { PlanNotice } from '../tier-limits.types'
import { PLAN_CATALOGUE, type CloudConfig } from './cloud.types'
import { daysUntil, trialChoiceDueAt } from '@/lib/shared/billing/trial-state'

export function plansActionUrl(config: Pick<CloudConfig, 'enabled' | 'canUpgrade'>): string | null {
  return config.enabled && config.canUpgrade ? '/admin/settings/billing' : null
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
    trialPlan: planLabel(config),
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

/**
 * The strip for an ended trial nobody has chosen a plan for. The workspace is
 * already running on Free limits, so it never asks for billing details: it
 * asks for a choice, and says by when. Teammates who cannot manage billing get
 * the same news without a button they could not use.
 */
export function trialEndedNotice(
  config: CloudConfig,
  options: { trialPlanName?: string | null; now?: Date; canManageBilling?: boolean } = {}
): PlanNotice | null {
  if (!config.enabled || !config.plan) return null
  const now = options.now ?? new Date()
  const dueAt = trialChoiceDueAt({
    plan: config.plan,
    trialActive: config.trialActive,
    trialExpiresAt: config.trialExpiresAt,
    status: config.subscriptionStatus,
    now,
  })
  if (!dueAt) return null
  const name = options.trialPlanName
  const label = name ? `${name} trial ended` : 'Trial ended'
  const base = { label, expiresAt: config.trialExpiresAt!, ended: true as const }
  if (options.canManageBilling === false) {
    return {
      ...base,
      message: 'The workspace owner needs to choose a plan. Until then, Free limits apply.',
    }
  }
  const actionUrl = plansActionUrl(config)
  return {
    ...base,
    message: name
      ? `Choose how this workspace continues: keep ${name}, or switch to Free.`
      : 'Choose how this workspace continues: pick a paid plan, or switch to Free.',
    ...(actionUrl
      ? { actionUrl, actionLabel: 'Choose a plan', choiceDueAt: dueAt.toISOString() }
      : {}),
  }
}
