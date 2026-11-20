/**
 * The plan limits copy never shows the internal vocabulary. Every sentence the
 * copy helpers can build (banner, page rows, paused notices, the single
 * sign-on notice, downgrade lines) is rendered across both phases, every cap,
 * every feature and both billing rights, then scanned for the words that stay
 * internal: grace, enforced, held, frozen, extras, switch, "current plan",
 * "on your plan", "Choose a plan", "Keep Pro", "Restore what is paused", and
 * em dashes.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/functions/plan-limits', () => ({ getPlanLimitsFn: vi.fn() }))

import { formatFirstRenderDate } from '@/components/ui/local-date'
import {
  planFeatureNotice,
  type PlanNoticeFeature,
} from '@/components/admin/settings/plan-feature-notice-body'
import { ssoPausesText } from '@/components/admin/settings/security/identity-providers/sso-pauses-notice'
import { PLAN_LIMIT_INFO_CAP_KEYS } from '@/lib/server/domains/plan-limits/plan-limits.rules'
import {
  PLAN_FEATURE_KEYS,
  PLAN_FEATURE_LINKS,
} from '@/lib/server/domains/plan-limits/plan-limits.features'
import { PLAN_IDS } from '@/lib/server/domains/settings/cloud/cloud.types'
import {
  capConsequence,
  featureConsequence,
  infoRowNote,
  keepEverythingLines,
  pausedSummary,
  planLimitsBannerCopy,
} from '@/lib/shared/billing/plan-limits-copy'
import {
  PLAN_NUMERIC_CAPS,
  capIssues,
  featuresDisabledOnDowngrade,
  type PlanCapKey,
} from '@/lib/shared/billing/plan-downgrade'

const BANNED = [
  /\bgrace\b/i,
  /\benforce(d|ment)?\b/i,
  /\bheld\b/i,
  /\bfrozen\b/i,
  /\bextras\b/i,
  /\bswitch/i,
  /\bcurrent plan\b/i,
  /\bon your plan\b/i,
  /\bchoose a plan\b/i,
  /\bkeep pro\b/i,
  /\brestore what is paused\b/i,
  /—/,
]

const format = (date: unknown, options?: Intl.DateTimeFormatOptions) =>
  formatFirstRenderDate(date as string, options, 'en-US')

const CAP_KEYS = Object.keys(PLAN_NUMERIC_CAPS.free) as PlanCapKey[]
const NOTICE_FEATURES: PlanNoticeFeature[] = [
  'webhooks',
  'workflows',
  'integrations',
  'customDomain',
  'customCss',
  'aiAssistant',
  'aiArticleTranslation',
]
const PHASES = ['grace', 'enforced'] as const

function bannedIn(text: string): RegExp[] {
  return BANNED.filter((word) => word.test(text))
}

/** Every user-facing line the helpers build, each labelled with where it came from. */
function allCopy(): Array<[string, string]> {
  const lines: Array<[string, string]> = []
  const add = (where: string, text: string | null | undefined) => {
    if (text) lines.push([where, text])
  }
  const issues = CAP_KEYS.map((key) => ({ key, used: 5, cap: 1, href: '/admin' }))
  // The features the page lists, as it lists them.
  const featureIssues = PLAN_FEATURE_KEYS.flatMap((key) => {
    const link = PLAN_FEATURE_LINKS[key]
    return link ? [{ key, count: 2, label: link.label, href: link.href }] : []
  })
  for (const phase of PHASES) {
    for (const key of CAP_KEYS) {
      for (const excess of [1, 3])
        add(`cap ${key} ${phase}`, capConsequence(key, excess, phase, 'Nov 24', 'Free'))
    }
    for (const key of PLAN_FEATURE_KEYS) {
      add(`feature ${key} ${phase}`, featureConsequence(key, 2, phase, 'Free'))
    }
    for (const canManageBilling of [true, false]) {
      for (const over of [issues, issues.slice(0, 1), []]) {
        const copy = planLimitsBannerCopy(
          {
            enabled: true,
            phase,
            issues: over,
            featureIssues,
            planName: 'Free',
            fromPlanName: 'Business',
            canManageBilling,
          } as never,
          'Nov 24'
        )
        add(
          `banner ${phase} ${over.length} ${canManageBilling}`,
          copy && `${copy.title} ${copy.body} ${copy.action}`
        )
      }
      for (const feature of NOTICE_FEATURES) {
        const notice = planFeatureNotice(
          feature,
          {
            enabled: true,
            phase,
            planName: 'Free',
            graceEndsAt: '2026-11-25T00:00:00.000Z',
            deadlineDay: '2026-11-24',
            featureIssues: [{ key: feature }],
            canManageBilling,
          },
          format,
          new Date('2026-11-18T09:00:00.000Z')
        )
        add(`notice ${feature} ${phase}`, notice?.text)
      }
    }
  }
  // The rows shown for information only: the info caps and the used-up meters.
  for (const key of [...PLAN_LIMIT_INFO_CAP_KEYS, 'aiTokensPerMonth', 'emailsPerMonth']) {
    add(`info ${key}`, infoRowNote({ key, message: 'AI usage is used up for this month', cap: 1 }))
  }
  add('paused summary', pausedSummary({ issues, featureIssues } as never))
  for (const plan of PLAN_IDS) {
    for (const line of keepEverythingLines(
      { issues, infoRows: [], featureIssues } as never,
      plan
    )) {
      add(`keep ${plan}`, line)
    }
    for (const from of PLAN_IDS) {
      for (const line of featuresDisabledOnDowngrade(from, plan))
        add(`downgrade ${from}>${plan}`, line)
    }
    for (const issue of capIssues(
      Object.fromEntries(CAP_KEYS.map((k) => [k, 1000])),
      PLAN_NUMERIC_CAPS[plan]
    )) {
      add(`downgrade issue ${plan} ${issue.key}`, `${issue.message} ${issue.actionLabel}`)
    }
  }
  add('sso pauses', ssoPausesText('2026-11-24', format, new Date('2026-11-18T09:00:00.000Z')))
  add('sso ask', 'Ask someone who manages billing to upgrade.')
  return lines
}

describe('plan limits copy words', () => {
  const lines = allCopy()

  it('renders a line for every cap, feature and notice', () => {
    expect(lines.length).toBeGreaterThan(100)
    expect(lines.some(([, text]) => text.includes('read-only'))).toBe(true)
    expect(lines.some(([, text]) => text.startsWith('Single sign-on pauses after Nov 24'))).toBe(
      true
    )
  })

  it('never uses the internal words', () => {
    const offending = lines
      .map(([where, text]) => ({ where, text, words: bannedIn(text).map(String) }))
      .filter((line) => line.words.length > 0)
    expect(offending).toEqual([])
  })

  it('catches each banned word', () => {
    for (const sample of [
      'Fix by Nov 24 or the grace ends.',
      'Limits are enforced now.',
      'Switch to Free',
      'Paused on the current plan.',
      'Keep Pro',
      'Paused — nothing is deleted.',
    ]) {
      expect(bannedIn(sample)).not.toEqual([])
    }
  })
})
