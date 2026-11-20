/**
 * The words the plan limits core shows people: trial notices, the Plan
 * limits page's issue rows, info rows and feature labels. None may use the
 * internal vocabulary (grace, enforced, held...), "switch" for a plan change,
 * "current plan" for the plan's name, an em dash or an exclamation mark.
 */
import { describe, expect, it } from 'vitest'
import { OSS_TIER_LIMITS, type TierLimits } from '@/lib/server/domains/settings/tier-limits.types'
import {
  DISABLED_CLOUD_CONFIG,
  type CloudConfig,
} from '@/lib/server/domains/settings/cloud/cloud.types'
import {
  trialEndedNotice,
  trialNotice,
} from '@/lib/server/domains/settings/cloud/commercial-notice'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { capIssues, PLAN_NUMERIC_CAPS, type PlanCapKey } from '@/lib/shared/billing/plan-downgrade'
import { PLAN_FEATURE_KEYS, PLAN_FEATURE_LINKS, planFeatureSet } from '../plan-limits.features'
import { computePlanLimits } from '../plan-limits.rules'
import { planLimitsPage } from '../plan-limits.page'

const BANNED: RegExp[] = [
  /\bgrace\b/i,
  /\bfrozen\b/i,
  /\bfreeze\b/i,
  /\bheld\b/i,
  /\bswitch(es|ed|ing)?\b/i,
  /\benforce(d|ment)?\b/i,
  /\bextras\b/i,
  /\bcurrent plan\b/i,
  /\bon your plan\b/i,
  /\bChoose a plan\b/,
  /\bChoose Pro\b/,
  /\bKeep Pro\b/,
  /Restore what is paused/,
  /—/,
  /!/,
]

function bannedIn(text: string): string[] {
  return BANNED.filter((pattern) => pattern.test(text)).map(String)
}

const NOW = new Date('2026-08-20T12:00:00.000Z')

function config(over: Partial<CloudConfig>): CloudConfig {
  return {
    ...DISABLED_CLOUD_CONFIG,
    enabled: true,
    plan: 'pro',
    entitlements: {},
    trialStartedAt: '2026-08-06T00:00:00.000Z',
    trialExpiresAt: '2026-08-30T00:00:00.000Z',
    trialActive: true,
    canUpgrade: true,
    ...over,
  }
}

function noticeStrings(): string[] {
  const ended = config({
    plan: 'free',
    trialActive: false,
    trialExpiresAt: '2026-08-19T00:00:00.000Z',
  })
  const notices = [
    trialNotice(config({}), NOW),
    trialNotice(config({ trialExpiresAt: '2026-08-21T00:00:00.000Z' }), NOW),
    trialEndedNotice(ended, { now: NOW, trialPlanName: 'Pro' }),
    trialEndedNotice(ended, { now: NOW }),
    trialEndedNotice(ended, { now: NOW, canManageBilling: false }),
  ]
  return notices.flatMap((n) => (n ? [n.label, n.message ?? '', n.actionLabel ?? ''] : []))
}

function pageStrings(): string[] {
  const limits: TierLimits = {
    ...OSS_TIER_LIMITS,
    ...PLAN_NUMERIC_CAPS.free,
    aiTokensPerMonth: 10,
    emailsPerMonth: 10,
    features: Object.fromEntries(
      Object.keys(OSS_TIER_LIMITS.features).map((key) => [key, false])
    ) as unknown as TierLimits['features'],
  }
  const used = Object.fromEntries(
    [...Object.keys(PLAN_NUMERIC_CAPS.free), 'aiTokensPerMonth', 'emailsPerMonth'].map((key) => [
      key,
      10_000,
    ])
  )
  const configured = Object.fromEntries(PLAN_FEATURE_KEYS.map((key) => [key, 1]))
  const { view } = computePlanLimits(
    {
      enabled: true,
      plan: 'free',
      limits,
      features: planFeatureSet(limits.features, config({ plan: 'free', trialActive: false })),
      usage: used,
      configured,
      stored: null,
      previous: null,
      candidates: {},
    },
    NOW
  )
  const page = planLimitsPage(view, {}, [PERMISSIONS.BILLING_MANAGE])
  return [
    ...page.issues.flatMap((i) => [i.message, i.actionLabel]),
    ...page.infoRows.map((r) => r.message),
    ...page.featureIssues.map((f) => f.label),
    ...(page.planName ? [page.planName] : []),
  ]
}

function issueStrings(): string[] {
  const keys = Object.keys(PLAN_NUMERIC_CAPS.free) as PlanCapKey[]
  const caps = Object.fromEntries(keys.map((key) => [key, 1]))
  return [1, 2, 3].flatMap((extra) =>
    capIssues(Object.fromEntries(keys.map((key) => [key, 1 + extra])), caps).flatMap((i) => [
      i.message,
      i.actionLabel,
    ])
  )
}

describe('plan limits copy', () => {
  const sources: Record<string, () => string[]> = {
    'trial notices': noticeStrings,
    'Plan limits page rows': pageStrings,
    'issue rows for every cap': issueStrings,
    'paused feature labels': () => Object.values(PLAN_FEATURE_LINKS).map((link) => link!.label),
  }

  for (const [name, read] of Object.entries(sources)) {
    it(`keeps the internal vocabulary out of the ${name}`, () => {
      const strings = read().filter((s) => s.length > 0)
      expect(strings.length).toBeGreaterThan(2)
      const offending = strings
        .map((text) => ({ text, banned: bannedIn(text) }))
        .filter((hit) => hit.banned.length > 0)
      expect(offending).toEqual([])
    })
  }

  it('catches each banned word', () => {
    for (const text of [
      'Your grace period ends soon',
      'Boards are frozen',
      'Switch to Free',
      'Enforced on the current plan',
      'Choose a plan',
      'Keep Pro',
      'Pick one — now',
      'Done!',
    ]) {
      expect(bannedIn(text), text).not.toEqual([])
    }
    expect(bannedIn('Upgrade to Pro to keep everything, or downgrade to Free.')).toEqual([])
  })
})
