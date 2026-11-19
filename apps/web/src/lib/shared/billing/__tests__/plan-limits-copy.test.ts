/**
 * The plan limits words, checked as people read them: every line the copy
 * module can produce, for every cap, feature, phase and plan name, never
 * uses a word the glossary keeps from users. The scan reads the output, not
 * the source, so identifiers such as the `grace` phase never trip it.
 */
import { describe, expect, it } from 'vitest'
import type { PlanLimitsPage } from '@/lib/server/domains/plan-limits/plan-limits.page'
import {
  PLAN_FEATURE_LINKS,
  type PlanFeatureKey,
} from '@/lib/server/domains/plan-limits/plan-limits.features'
import { PLAN_CATALOGUE, type PlanId } from '@/lib/server/domains/settings/cloud/cloud.types'
import { PLAN_NUMERIC_CAPS, featuresDisabledOnDowngrade, type PlanCapKey } from '../plan-downgrade'
import {
  capConsequence,
  featureConsequence,
  infoRowNote,
  keepEverythingLines,
  pausedSummary,
  planLimitsBannerCopy,
  planLimitsDateOptions,
  planLimitsShownDay,
  type PlanLimitsTense,
} from '../plan-limits-copy'

/** Words and phrases the glossary never shows users, plus em dashes and exclamation marks. */
const BANNED =
  /\b(grace|frozen|freeze|held|switch(ed|ing)?|enforced|enforcement|extras)\b|current plan|on your plan|choose a plan|choose pro|keep pro|restore what is paused|—|!/i

const CAP_KEYS = Object.keys(PLAN_NUMERIC_CAPS.free) as PlanCapKey[]
const FEATURE_KEYS = Object.keys(PLAN_FEATURE_LINKS) as PlanFeatureKey[]
const TENSES: PlanLimitsTense[] = ['grace', 'enforced']
const PLAN_NAMES: Array<string | null> = ['Free', 'Pro', null]

function page(over: Partial<PlanLimitsPage>): PlanLimitsPage {
  const issues = CAP_KEYS.map((key) => ({
    key: key as PlanLimitsPage['issues'][number]['key'],
    used: 5,
    cap: 1,
    message: `You have 5 out of 1 ${key}`,
    actionLabel: 'Remove 4',
    href: '/admin',
  }))
  return {
    enabled: true,
    phase: 'grace',
    plan: 'free',
    since: '2026-11-18T12:00:00.000Z',
    graceEndsAt: '2026-11-25T12:00:00.000Z',
    deadlineDay: '2026-11-24',
    fromPlan: 'business',
    issues,
    fixedIssues: [],
    infoRows: [],
    featureIssues: FEATURE_KEYS.map((key) => ({
      key,
      count: 2,
      label: PLAN_FEATURE_LINKS[key]!.label,
      href: PLAN_FEATURE_LINKS[key]!.href,
    })),
    openBoardIds: null,
    keptBoardId: null,
    seatHolderIds: null,
    visibleStatusComponentIds: null,
    sendingDomainIds: null,
    planName: 'Free',
    fromPlanName: 'Business',
    choosers: { board: true, seats: true, statusComponents: true, sendingDomains: true },
    candidates: {},
    lockedSeatHolderIds: [],
    canManageBilling: true,
    ...over,
  }
}

/** Every line the module produces across caps, features, phases, counts and plan names. */
function everyLine(): string[] {
  const lines: string[] = []
  for (const tense of TENSES) {
    for (const plan of PLAN_NAMES) {
      for (const key of CAP_KEYS) {
        for (const excess of [1, 3]) {
          lines.push(capConsequence(key, excess, tense, 'Nov 24', plan ?? undefined))
        }
      }
      for (const key of FEATURE_KEYS) {
        for (const count of [1, 2]) {
          lines.push(featureConsequence(key, count, tense, plan ?? undefined))
        }
      }
      for (const canManageBilling of [true, false]) {
        for (const issues of [page({}).issues, page({}).issues.slice(0, 1), []]) {
          const copy = planLimitsBannerCopy(
            page({ phase: tense, planName: plan, canManageBilling, issues }),
            'Nov 24'
          )
          if (copy) lines.push(copy.title, copy.body, copy.action ?? '')
        }
      }
    }
  }
  for (const key of CAP_KEYS) {
    lines.push(infoRowNote({ key, message: `You have 77 out of 50 ${key}`, cap: 50 }))
  }
  for (const key of ['aiTokensPerMonth', 'emailsPerMonth']) {
    lines.push(infoRowNote({ key, message: 'AI usage is used up for this month', cap: 1 }))
  }
  lines.push(pausedSummary(page({})))
  for (const target of Object.keys(PLAN_CATALOGUE) as PlanId[]) {
    lines.push(...keepEverythingLines(page({}), target))
    for (const from of Object.keys(PLAN_CATALOGUE) as PlanId[]) {
      lines.push(...featuresDisabledOnDowngrade(from, target, { planLimits: true }))
    }
  }
  return lines
}

describe('plan limits copy: words kept from users', () => {
  it('says none of them, in any phase, for any plan, with or without billing rights', () => {
    const lines = everyLine()
    expect(lines.length).toBeGreaterThan(200)
    expect(lines.filter((line) => BANNED.test(line))).toEqual([])
  })

  it('names the plan, or says "this plan" when there is none, never "the current plan"', () => {
    const copy = planLimitsBannerCopy(page({ planName: null }), 'Nov 24')
    expect(copy?.title).toBe("Your workspace is over its plan's limits.")
    expect(capConsequence('maxCustomRoles', 1, 'enforced', '')).toBe(
      'Custom roles are locked on this plan. People on them keep their access.'
    )
    expect(featureConsequence('webhooks', 1, 'enforced')).toBe('Paused on this plan.')
    expect(featureConsequence('webhooks', 1, 'enforced', 'Free')).toBe('Paused on the Free plan.')
  })

  it('catches a banned word when one slips in', () => {
    expect(BANNED.test('Webhooks pause after the grace period.')).toBe(true)
    expect(BANNED.test('Switch to Free')).toBe(true)
    expect(BANNED.test('On your current plan')).toBe(true)
    expect(BANNED.test('Fix 3 issues by Nov 24, or upgrade to keep everything.')).toBe(false)
  })
})

describe('plan limits copy: the glossary lines', () => {
  it('words the banner as the glossary does, in both phases', () => {
    const limits = page({ issues: page({}).issues.slice(0, 3), featureIssues: [] })
    expect(planLimitsBannerCopy(limits, 'Nov 24')).toEqual({
      tone: 'grace',
      title: "Your workspace is over the Free plan's limits.",
      body: 'Fix 3 issues by Nov 24, or upgrade to keep everything.',
      action: 'Review issues',
    })
    expect(planLimitsBannerCopy({ ...limits, canManageBilling: false }, 'Nov 24')?.body).toBe(
      'Fix 3 issues by Nov 24. Ask someone who manages billing to upgrade.'
    )
    // Features alone, before the date: nothing to fix, only what pauses.
    expect(
      planLimitsBannerCopy(page({ issues: [], featureIssues: page({}).featureIssues }), 'Nov 24')
        ?.body
    ).toBe('Some features pause after Nov 24. Upgrade to keep everything.')
  })

  it('shows nothing once it fits, with the flag off, or with only features paused after the date', () => {
    expect(planLimitsBannerCopy(page({ phase: 'ok' }), 'Nov 24')).toBeNull()
    expect(planLimitsBannerCopy(page({ enabled: false }), 'Nov 24')).toBeNull()
    expect(planLimitsBannerCopy(page({ phase: 'enforced', issues: [] }), 'Nov 24')).toBeNull()
  })

  it('says each cap with its one verb, and nothing is deleted once per surface, not per row', () => {
    expect(capConsequence('maxBoards', 4, 'grace', 'Nov 23')).toBe(
      'After Nov 23, 4 boards become read-only. Their posts stay visible.'
    )
    expect(capConsequence('maxTeamSeats', 3, 'grace', 'Nov 23')).toBe(
      'After Nov 23, 3 teammates lose admin access until a seat frees up.'
    )
    expect(capConsequence('maxSendingDomains', 1, 'enforced', '', 'Pro')).toBe(
      'Paused on the Pro plan. Email goes from your default address.'
    )
    expect(infoRowNote({ key: 'maxPosts', message: '', cap: 50 })).toBe(
      'New posts stop at 50. Existing posts stay.'
    )
    expect(infoRowNote({ key: 'maxStatusSubscribers', message: '', cap: 100 })).toBe(
      'New sign-ups stop at 100. Existing subscribers keep getting updates.'
    )
    expect(everyLine().filter((line) => /Nothing is deleted/.test(line))).toEqual([])
  })
})

describe('plan limits copy: the day shown', () => {
  it('is the last full day to fix during grace, and the day things paused after it', () => {
    const grace = page({})
    expect(planLimitsShownDay(grace)?.toISOString()).toBe('2026-11-24T12:00:00.000Z')
    expect(planLimitsShownDay({ ...grace, phase: 'enforced' })?.toISOString()).toBe(
      '2026-11-25T12:00:00.000Z'
    )
    expect(planLimitsShownDay({ ...grace, deadlineDay: null })).toBeNull()
    expect(planLimitsShownDay({ ...grace, phase: 'enforced', graceEndsAt: null })).toBeNull()
  })

  it('adds the year only when the day falls in another year than today', () => {
    const base = { day: 'numeric', month: 'short', timeZone: 'UTC' } as const
    const now = new Date('2026-12-28T09:00:00.000Z')
    expect(planLimitsDateOptions(new Date('2026-12-31T12:00:00.000Z'), base, now)).toEqual(base)
    expect(planLimitsDateOptions(new Date('2027-01-02T12:00:00.000Z'), base, now)).toEqual({
      ...base,
      year: 'numeric',
    })
    expect(
      planLimitsDateOptions(new Date('2026-12-30T12:00:00.000Z'), base, new Date('2027-01-03'))
    ).toEqual({ ...base, year: 'numeric' })
    // Judged on the UTC calendar, as the day itself is.
    expect(
      planLimitsDateOptions(
        new Date('2027-01-01T12:00:00.000Z'),
        base,
        new Date('2026-12-31T23:30:00.000-05:00')
      )
    ).toEqual(base)
    expect(planLimitsDateOptions(null, base, now)).toEqual(base)
  })
})
