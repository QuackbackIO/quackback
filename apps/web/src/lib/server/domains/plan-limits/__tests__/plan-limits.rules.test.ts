import { describe, expect, it } from 'vitest'
import { OSS_TIER_LIMITS, type TierLimits } from '@/lib/server/domains/settings/tier-limits.types'
import {
  DISABLED_CLOUD_CONFIG,
  ENTITLEMENT_KEYS,
} from '@/lib/server/domains/settings/cloud/cloud.types'
import type { CloudConfig } from '@/lib/server/domains/settings/cloud/cloud.types'
import {
  PLAN_FEATURES,
  PLAN_FEATURE_KEYS,
  planFeatureSet,
  type PlanFeatureSet,
} from '../plan-limits.features'
import {
  PLAN_LIMITS_GRACE_MS,
  computePlanLimits,
  featureLive,
  limitsKeyFor,
  needsUsage,
  openBoardOrder,
  parsePlanLimitsState,
  seatHolderOrder,
  sendingDomainOrder,
  statusComponentOrder,
  type PlanLimitsInputs,
  type PlanLimitsState,
} from '../plan-limits.rules'

const NOW = new Date('2026-11-18T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const at = (ms: number) => new Date(NOW.getTime() + ms)

const FREE_LIMITS: TierLimits = {
  ...OSS_TIER_LIMITS,
  maxBoards: 1,
  maxPosts: 50,
  maxTeamSeats: 1,
  maxStatusComponents: 3,
  maxCustomRoles: 0,
  maxSendingDomains: 0,
  maxInboundEmailAddresses: 1,
  maxHelpCenterLocales: 1,
  maxStatusSubscribers: 100,
  aiTokensPerMonth: 1000,
  emailsPerMonth: 500,
  features: {
    ...OSS_TIER_LIMITS.features,
    customDomain: false,
    customOidcProvider: false,
    webhooks: false,
    mcpServer: false,
    customCss: false,
    integrations: false,
    analyticsExports: false,
  },
}

const FREE_CONFIG: CloudConfig = {
  ...DISABLED_CLOUD_CONFIG,
  enabled: true,
  plan: 'free',
  entitlements: { aiDrafts: true, apiAccess: true },
}

const PRO_CONFIG: CloudConfig = {
  ...FREE_CONFIG,
  plan: 'pro',
  entitlements: {
    customDomain: true,
    aiAssistant: true,
    aiDrafts: true,
    aiInsights: true,
    apiAccess: true,
    mcpServer: true,
    webhooks: true,
  },
}

const FREE_FEATURES = planFeatureSet(FREE_LIMITS.features, FREE_CONFIG)
const ALL_LIVE = planFeatureSet(OSS_TIER_LIMITS.features, DISABLED_CLOUD_CONFIG)

const FITS: Record<string, number> = {
  maxBoards: 1,
  maxPosts: 10,
  maxTeamSeats: 1,
  maxStatusComponents: 1,
  maxCustomRoles: 0,
  maxSendingDomains: 0,
  maxInboundEmailAddresses: 1,
  maxHelpCenterLocales: 1,
  maxStatusSubscribers: 5,
  aiTokensPerMonth: 0,
  emailsPerMonth: 0,
}

function inputs(over: Partial<PlanLimitsInputs> = {}): PlanLimitsInputs {
  return {
    enabled: true,
    plan: 'free',
    limits: FREE_LIMITS,
    features: FREE_FEATURES,
    usage: FITS,
    configured: {},
    stored: null,
    previous: null,
    candidates: {},
    ...over,
  }
}

const OVER_BOARDS = { ...FITS, maxBoards: 5 }

describe('the feature key space', () => {
  it('covers every plan entitlement but the display-only branding overlay', () => {
    const covered = new Set<string>(
      Object.values(PLAN_FEATURES)
        .map((f) => f.entitlement as string | null)
        .filter((key): key is string => key !== null)
    )
    expect(ENTITLEMENT_KEYS.filter((key) => !covered.has(key))).toEqual(['hideBranding'])
  })

  it('covers every tier feature flag but the retired IP allowlist', () => {
    const covered = new Set(
      Object.values(PLAN_FEATURES)
        .map((f) => f.tierFeature)
        .filter(Boolean)
    )
    expect(
      Object.keys(OSS_TIER_LIMITS.features).filter((key) => !covered.has(key as never))
    ).toEqual(['ipAllowlist'])
  })

  it('is all live on an install without plan billing', () => {
    expect(PLAN_FEATURE_KEYS.every((key) => ALL_LIVE[key])).toBe(true)
  })

  it('needs both the tier feature and the entitlement when a key has both', () => {
    const webhooksOffInTier = planFeatureSet(
      { ...OSS_TIER_LIMITS.features, webhooks: false },
      PRO_CONFIG
    )
    expect(webhooksOffInTier.webhooks).toBe(false)
    expect(planFeatureSet(OSS_TIER_LIMITS.features, PRO_CONFIG).webhooks).toBe(true)
    expect(planFeatureSet(OSS_TIER_LIMITS.features, FREE_CONFIG).webhooks).toBe(false)
  })

  it("follows the one gate today's runtime path reads for single sign-on and MCP", () => {
    // Single sign-on: the provider list reads the tier flag alone.
    const ssoTierOnly = planFeatureSet(
      { ...OSS_TIER_LIMITS.features, customOidcProvider: true },
      FREE_CONFIG
    )
    expect(ssoTierOnly.sso).toBe(true)
    expect(
      planFeatureSet(
        { ...OSS_TIER_LIMITS.features, customOidcProvider: false },
        DISABLED_CLOUD_CONFIG
      ).sso
    ).toBe(false)
    // MCP: the handler reads the entitlement alone.
    const mcpEntitled = planFeatureSet(
      { ...OSS_TIER_LIMITS.features, mcpServer: false },
      PRO_CONFIG
    )
    expect(mcpEntitled.mcpServer).toBe(true)
    expect(planFeatureSet(OSS_TIER_LIMITS.features, FREE_CONFIG).mcpServer).toBe(false)
  })

  it('keeps grace to features that run on their own, not the ones that stop at once', () => {
    expect(PLAN_FEATURES.mcpServer.grace).toBe(false)
    expect(PLAN_FEATURES.aiInsights.grace).toBe(false)
    expect(PLAN_FEATURES.auditLog.grace).toBe(false)
    expect(PLAN_FEATURES.webhooks.grace).toBe(true)
    expect(PLAN_FEATURES.workflows.grace).toBe(true)
    expect(PLAN_FEATURES.sso.grace).toBe(true)
  })
})

describe('computePlanLimits: flag off', () => {
  it('leaves a stored state alone, so turning the flag on again resumes it with its choices', () => {
    const stored = {
      ...computePlanLimits(inputs({ usage: OVER_BOARDS }), at(-30 * DAY)).nextState!,
      keptBoardId: 'b1',
    }
    const result = computePlanLimits(inputs({ enabled: false, stored, usage: OVER_BOARDS }), NOW)
    expect(result.view.phase).toBe('ok')
    expect(result.changed).toBe(false)
    expect(result.nextState).toBe(stored)
  })

  it('is ok and stores nothing even when far over every cap', () => {
    const result = computePlanLimits(
      inputs({ enabled: false, usage: { ...OVER_BOARDS, maxTeamSeats: 9 } }),
      NOW
    )
    expect(result.view.phase).toBe('ok')
    expect(result.view.issues).toEqual([])
    expect(result.nextState).toBeNull()
    expect(result.changed).toBe(false)
  })
})

describe('computePlanLimits: unlimited', () => {
  it('is always ok with unlimited limits and every feature on', () => {
    const result = computePlanLimits(
      inputs({
        plan: null,
        limits: OSS_TIER_LIMITS,
        features: ALL_LIVE,
        usage: { maxBoards: 500, maxTeamSeats: 900, maxPosts: 1e6 },
        configured: { webhooks: 4, workflows: 2 },
      }),
      NOW
    )
    expect(result.view.phase).toBe('ok')
    expect(result.view.issues).toEqual([])
    expect(result.view.featureIssues).toEqual([])
    expect(result.nextState).toBeNull()
  })

  it('needs no usage read when nothing is capped and every feature is on', () => {
    expect(needsUsage({ enabled: true, limits: OSS_TIER_LIMITS, features: ALL_LIVE })).toBe(false)
    expect(needsUsage({ enabled: false, limits: FREE_LIMITS, features: FREE_FEATURES })).toBe(false)
    expect(needsUsage({ enabled: true, limits: FREE_LIMITS, features: FREE_FEATURES })).toBe(true)
    expect(
      needsUsage({
        enabled: true,
        limits: OSS_TIER_LIMITS,
        features: { ...ALL_LIVE, webhooks: false },
      })
    ).toBe(true)
  })

  it('is ok without usage when none is needed', () => {
    const result = computePlanLimits(
      inputs({
        plan: null,
        limits: OSS_TIER_LIMITS,
        features: ALL_LIVE,
        usage: null,
        configured: null,
      }),
      NOW
    )
    expect(result.view.phase).toBe('ok')
  })
})

describe('computePlanLimits: issues and info rows', () => {
  it('lists caps that need a fix against the current limits', () => {
    const result = computePlanLimits(
      inputs({ usage: { ...FITS, maxBoards: 5, maxTeamSeats: 3, maxStatusComponents: 4 } }),
      NOW
    )
    expect(result.view.issues.map((i) => [i.key, i.used, i.cap])).toEqual([
      ['maxBoards', 5, 1],
      ['maxTeamSeats', 3, 1],
      ['maxStatusComponents', 4, 3],
    ])
  })

  it('reads the effective limits, not a catalogue plan', () => {
    const result = computePlanLimits(
      inputs({ limits: { ...FREE_LIMITS, maxBoards: 3 }, usage: { ...FITS, maxBoards: 3 } }),
      NOW
    )
    expect(result.view.issues).toEqual([])
  })

  it('shows posts, status subscribers and inbound addresses as information, never as issues', () => {
    const result = computePlanLimits(
      inputs({
        usage: {
          ...FITS,
          maxPosts: 400,
          maxStatusSubscribers: 150,
          maxInboundEmailAddresses: 2,
        },
      }),
      NOW
    )
    expect(result.view.phase).toBe('ok')
    expect(result.view.issues).toEqual([])
    expect(result.view.infoRows.map((row) => row.key)).toEqual([
      'maxPosts',
      'maxInboundEmailAddresses',
      'maxStatusSubscribers',
    ])
    expect(result.nextState).toBeNull()
  })

  it('shows a used-up meter as information', () => {
    const result = computePlanLimits(
      inputs({ usage: { ...FITS, aiTokensPerMonth: 1000, emailsPerMonth: 20 } }),
      NOW
    )
    expect(result.view.infoRows.map((row) => row.key)).toEqual(['aiTokensPerMonth'])
  })

  it('lists paid features that are set up but not in the plan, with their counts', () => {
    const result = computePlanLimits(
      inputs({
        configured: { webhooks: 2, workflows: 3, customCss: 1, mcpServer: 0, aiDrafts: 4 },
      }),
      NOW
    )
    expect(result.view.featureIssues).toEqual([
      { key: 'webhooks', count: 2 },
      { key: 'workflows', count: 3 },
      { key: 'customCss', count: 1 },
    ])
    expect(result.view.phase).toBe('grace')
  })
})

describe('computePlanLimits: phases', () => {
  it('starts a 7-day grace on first detection and records the plan before the drop', () => {
    const previous = {
      plan: 'pro' as const,
      features: planFeatureSet(OSS_TIER_LIMITS.features, PRO_CONFIG),
    }
    const result = computePlanLimits(inputs({ usage: OVER_BOARDS, previous }), NOW)
    expect(result.view.phase).toBe('grace')
    expect(result.changed).toBe(true)
    expect(result.nextState).toMatchObject({
      since: NOW.toISOString(),
      graceEndsAt: new Date(NOW.getTime() + PLAN_LIMITS_GRACE_MS).toISOString(),
      fromPlan: 'pro',
    })
    expect(PLAN_LIMITS_GRACE_MS).toBe(7 * DAY)
    expect(result.nextState?.fromFeatures.webhooks).toBe(true)
    expect(result.view.since).toBe(NOW.toISOString())
  })

  it('never moves the dates on later checks', () => {
    const first = computePlanLimits(inputs({ usage: OVER_BOARDS }), at(-2 * DAY))
    const later = computePlanLimits(inputs({ usage: OVER_BOARDS, stored: first.nextState }), NOW)
    expect(later.changed).toBe(false)
    expect(later.nextState).toBe(first.nextState)
    expect(later.view.since).toBe(at(-2 * DAY).toISOString())
    expect(later.view.phase).toBe('grace')
  })

  it('is enforced once the grace has ended', () => {
    const first = computePlanLimits(inputs({ usage: OVER_BOARDS }), at(-7 * DAY))
    expect(
      computePlanLimits(inputs({ usage: OVER_BOARDS, stored: first.nextState }), at(-1)).view.phase
    ).toBe('grace')
    expect(
      computePlanLimits(inputs({ usage: OVER_BOARDS, stored: first.nextState }), NOW).view.phase
    ).toBe('enforced')
  })

  it('is ok the moment the excess is gone, and reports no dates', () => {
    const first = computePlanLimits(inputs({ usage: OVER_BOARDS }), at(-2 * DAY))
    const fixed = computePlanLimits(inputs({ usage: FITS, stored: first.nextState }), NOW)
    expect(fixed.view.phase).toBe('ok')
    expect(fixed.view.since).toBeNull()
    expect(fixed.view.graceEndsAt).toBeNull()
  })

  it('gives no new grace for going back over the same limits after the grace ended', () => {
    const first = computePlanLimits(inputs({ usage: OVER_BOARDS }), at(-30 * DAY))
    const fixed = computePlanLimits(inputs({ usage: FITS, stored: first.nextState }), at(-20 * DAY))
    expect(fixed.view.phase).toBe('ok')
    const again = computePlanLimits(inputs({ usage: OVER_BOARDS, stored: fixed.nextState }), NOW)
    expect(again.view.phase).toBe('enforced')
    expect(again.changed).toBe(false)
  })

  it('clears the state once the plan has changed and nothing is over', () => {
    const first = computePlanLimits(inputs({ usage: OVER_BOARDS }), at(-30 * DAY))
    const upgraded = computePlanLimits(
      inputs({
        plan: 'pro',
        limits: { ...FREE_LIMITS, maxBoards: null, maxTeamSeats: 5 },
        features: planFeatureSet(OSS_TIER_LIMITS.features, PRO_CONFIG),
        usage: OVER_BOARDS,
        stored: first.nextState,
      }),
      NOW
    )
    expect(upgraded.view.phase).toBe('ok')
    expect(upgraded.nextState).toBeNull()
    expect(upgraded.changed).toBe(true)
  })

  it('starts a new grace when a different plan is over its limits', () => {
    const first = computePlanLimits(inputs({ usage: OVER_BOARDS }), at(-30 * DAY))
    const proLimits = { ...FREE_LIMITS, maxBoards: null, maxTeamSeats: 5 }
    const onPro = computePlanLimits(
      inputs({
        plan: 'pro',
        limits: proLimits,
        features: planFeatureSet(OSS_TIER_LIMITS.features, PRO_CONFIG),
        usage: { ...OVER_BOARDS, maxTeamSeats: 9 },
        stored: { ...first.nextState!, keptBoardId: 'board_1' },
      }),
      NOW
    )
    expect(onPro.view.phase).toBe('grace')
    expect(onPro.nextState?.since).toBe(NOW.toISOString())
    expect(onPro.nextState?.keptBoardId).toBe('board_1')
  })

  it('gives a workspace already over when the flag turns on its grace from first detection', () => {
    const result = computePlanLimits(inputs({ usage: OVER_BOARDS, stored: null }), NOW)
    expect(result.view.graceEndsAt).toBe(at(7 * DAY).toISOString())
  })

  it('keeps what was running at first detection live through the grace when the plan before is unknown', () => {
    const result = computePlanLimits(
      inputs({ usage: OVER_BOARDS, configured: { webhooks: 1 } }),
      NOW
    )
    expect(result.nextState?.fromPlan).toBeNull()
    expect(result.nextState?.fromFeatures.webhooks).toBe(true)
    expect(result.nextState?.fromFeatures.workflows).toBe(false)
  })

  it('never carries an at-once feature into the grace', () => {
    const previous = {
      plan: 'pro' as const,
      features: planFeatureSet(OSS_TIER_LIMITS.features, PRO_CONFIG),
    }
    const result = computePlanLimits(
      inputs({ usage: OVER_BOARDS, previous, configured: { mcpServer: 1 } }),
      NOW
    )
    expect(result.nextState?.fromFeatures.mcpServer).toBe(false)
    expect(result.nextState?.fromFeatures.aiInsights).toBe(false)
  })
})

describe('computePlanLimits: a reader that has not seen the newer limits', () => {
  const PRO_LIMITS = { ...FREE_LIMITS, maxBoards: null, maxTeamSeats: 5 }
  const proFeatures = planFeatureSet(OSS_TIER_LIMITS.features, PRO_CONFIG)
  const BASIS = { cloudRevision: 4, authConfigVersion: 2 }

  it('records the inputs revision a grace was granted under', () => {
    const state = computePlanLimits(inputs({ usage: OVER_BOARDS, basis: BASIS }), NOW).nextState
    expect(state?.basis).toEqual(BASIS)
  })

  it('never clears a grace from limits older than the ones it was granted under', () => {
    const stored = computePlanLimits(
      inputs({ usage: OVER_BOARDS, basis: BASIS }),
      at(-DAY)
    ).nextState
    const stale = computePlanLimits(
      inputs({
        plan: 'pro',
        limits: PRO_LIMITS,
        features: proFeatures,
        usage: OVER_BOARDS,
        stored,
        basis: { cloudRevision: 3, authConfigVersion: 2 },
      }),
      NOW
    )
    expect(stale.changed).toBe(false)
    expect(stale.nextState).toBe(stored)
  })

  it('never restarts a grace from limits older than the ones it was granted under', () => {
    const stored = computePlanLimits(
      inputs({ usage: OVER_BOARDS, basis: BASIS }),
      at(-DAY)
    ).nextState
    const stale = computePlanLimits(
      inputs({
        limits: { ...FREE_LIMITS, maxBoards: 2 },
        usage: { ...OVER_BOARDS, maxBoards: 5 },
        stored,
        basis: { cloudRevision: 4, authConfigVersion: 1 },
      }),
      NOW
    )
    expect(stale.changed).toBe(false)
    expect(stale.view.since).toBe(at(-DAY).toISOString())
  })

  it('lets a reader that has seen newer limits clear or restart it', () => {
    const stored = computePlanLimits(
      inputs({ usage: OVER_BOARDS, basis: BASIS }),
      at(-DAY)
    ).nextState
    const newer = computePlanLimits(
      inputs({
        plan: 'pro',
        limits: PRO_LIMITS,
        features: proFeatures,
        usage: OVER_BOARDS,
        stored,
        basis: { cloudRevision: 5, authConfigVersion: 2 },
      }),
      NOW
    )
    expect(newer.nextState).toBeNull()
    expect(newer.changed).toBe(true)
  })

  it('lets the same inputs change the limits on the clock (a term lapsing)', () => {
    const stored = computePlanLimits(
      inputs({
        plan: 'pro',
        limits: { ...PRO_LIMITS, maxTeamSeats: 1 },
        features: proFeatures,
        usage: { ...FITS, maxTeamSeats: 3 },
        basis: BASIS,
      }),
      at(-DAY)
    ).nextState
    const lapsed = computePlanLimits(inputs({ usage: OVER_BOARDS, stored, basis: BASIS }), NOW)
    expect(lapsed.changed).toBe(true)
    expect(lapsed.nextState?.since).toBe(NOW.toISOString())
  })
})

describe('featureLive', () => {
  const previous = {
    plan: 'pro' as const,
    features: planFeatureSet(OSS_TIER_LIMITS.features, PRO_CONFIG),
  }

  it('is the current plan when the flag is off', () => {
    expect(
      featureLive(
        { enabled: false, phase: 'ok', features: FREE_FEATURES, fromFeatures: null },
        'webhooks'
      )
    ).toBe(false)
    expect(
      featureLive(
        { enabled: false, phase: 'ok', features: FREE_FEATURES, fromFeatures: null },
        'aiDrafts'
      )
    ).toBe(true)
  })

  it('keeps the previous plan live during grace and pauses it after', () => {
    const state = computePlanLimits(inputs({ usage: OVER_BOARDS, previous }), NOW).nextState!
    const live = (phase: 'grace' | 'enforced') =>
      featureLive(
        { enabled: true, phase, features: FREE_FEATURES, fromFeatures: state.fromFeatures },
        'webhooks'
      )
    expect(live('grace')).toBe(true)
    expect(live('enforced')).toBe(false)
  })

  it('is live whenever the current plan has it', () => {
    expect(
      featureLive(
        { enabled: true, phase: 'enforced', features: FREE_FEATURES, fromFeatures: null },
        'apiAccess'
      )
    ).toBe(true)
  })
})

describe('limitsKeyFor', () => {
  it('changes with the plan, a cap or a feature, and not with anything else', () => {
    const base = limitsKeyFor('free', FREE_LIMITS, FREE_FEATURES)
    expect(limitsKeyFor('free', { ...FREE_LIMITS }, { ...FREE_FEATURES })).toBe(base)
    expect(limitsKeyFor('pro', FREE_LIMITS, FREE_FEATURES)).not.toBe(base)
    expect(limitsKeyFor('free', { ...FREE_LIMITS, maxBoards: 2 }, FREE_FEATURES)).not.toBe(base)
    expect(limitsKeyFor('free', FREE_LIMITS, { ...FREE_FEATURES, webhooks: true })).not.toBe(base)
    expect(limitsKeyFor('free', { ...FREE_LIMITS, apiRequestsPerMinute: 5 }, FREE_FEATURES)).toBe(
      base
    )
    // Free's own grants arriving (a lapsed term read with none, then an explicit
    // Free projection) are the same drop, not a new one.
    expect(
      limitsKeyFor('free', FREE_LIMITS, { ...FREE_FEATURES, aiDrafts: false, apiAccess: false })
    ).toBe(base)
  })
})

describe('parsePlanLimitsState', () => {
  it('reads a stored state and drops anything malformed', () => {
    const state = computePlanLimits(inputs({ usage: OVER_BOARDS }), NOW).nextState!
    expect(parsePlanLimitsState(JSON.parse(JSON.stringify(state)))).toEqual(state)
    expect(parsePlanLimitsState(null)).toBeNull()
    expect(parsePlanLimitsState({ since: 'nope' })).toBeNull()
    expect(parsePlanLimitsState([])).toBeNull()
    expect(
      parsePlanLimitsState({ ...state, seatHolderIds: [1, 'principal_a'], keptBoardId: 7 })
    ).toEqual({ ...state, seatHolderIds: ['principal_a'] })
  })
})

describe('openBoardOrder', () => {
  const boards = [
    { id: 'b_old_small', postCount: 2, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'b_big', postCount: 40, createdAt: '2026-03-01T00:00:00.000Z' },
    { id: 'b_old_big', postCount: 40, createdAt: '2026-02-01T00:00:00.000Z' },
  ]

  it('keeps the board with the most posts, then the oldest, by default', () => {
    expect(openBoardOrder(boards, 1)).toEqual(['b_old_big'])
    expect(openBoardOrder(boards, 2)).toEqual(['b_old_big', 'b_big'])
  })

  it("keeps the admin's choice first", () => {
    expect(openBoardOrder(boards, 1, 'b_old_small')).toEqual(['b_old_small'])
  })

  it('falls back to the default when the chosen board is gone', () => {
    expect(openBoardOrder(boards, 1, 'b_deleted')).toEqual(['b_old_big'])
  })
})

describe('seatHolderOrder', () => {
  const member = (
    id: string,
    over: Partial<{
      isOwner: boolean
      canManageBilling: boolean
      lastActiveAt: string | null
      createdAt: string
    }> = {}
  ) => ({
    id,
    isOwner: false,
    canManageBilling: false,
    lastActiveAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  })

  it('keeps the owner, then billing managers, then the most recently active', () => {
    const members = [
      member('m_idle'),
      member('m_recent', { lastActiveAt: '2026-11-17T00:00:00.000Z' }),
      member('m_older', { lastActiveAt: '2026-10-01T00:00:00.000Z' }),
      member('m_billing', { canManageBilling: true, lastActiveAt: '2026-05-01T00:00:00.000Z' }),
      member('m_owner', { isOwner: true, canManageBilling: true }),
    ]
    expect(seatHolderOrder(members, 1)).toEqual(['m_owner'])
    expect(seatHolderOrder(members, 3)).toEqual(['m_owner', 'm_billing', 'm_recent'])
    expect(seatHolderOrder(members, 5)).toEqual([
      'm_owner',
      'm_billing',
      'm_recent',
      'm_older',
      'm_idle',
    ])
  })

  it('counts the owner toward the cap, so a choice never adds a seat past it', () => {
    const members = [
      member('m_owner', { isOwner: true, canManageBilling: true }),
      member('m_a'),
      member('m_b'),
    ]
    expect(seatHolderOrder(members, 1, ['m_a'])).toEqual(['m_owner'])
    expect(seatHolderOrder(members, 2, ['m_a'])).toEqual(['m_owner', 'm_a'])
    expect(seatHolderOrder(members, 2, ['m_a', 'm_b'])).toEqual(['m_owner', 'm_a'])
  })

  it('always keeps someone who can manage billing, even when the owner cannot', () => {
    const members = [
      member('m_owner', { isOwner: true }),
      member('m_billing', { canManageBilling: true }),
      member('m_a', { lastActiveAt: '2026-11-17T00:00:00.000Z' }),
    ]
    expect(seatHolderOrder(members, 1)).toEqual(['m_owner', 'm_billing'])
  })

  it('keeps someone who can manage billing when there is no owner', () => {
    const members = [
      member('m_a', { lastActiveAt: '2026-11-17T00:00:00.000Z' }),
      member('m_billing', { canManageBilling: true }),
    ]
    expect(seatHolderOrder(members, 1)).toEqual(['m_billing'])
  })

  it('keeps one owner when there are several, the earliest', () => {
    const members = [
      member('m_owner_new', {
        isOwner: true,
        canManageBilling: true,
        createdAt: '2026-06-01T00:00:00.000Z',
      }),
      member('m_owner_old', { isOwner: true, canManageBilling: true }),
    ]
    expect(seatHolderOrder(members, 1)).toEqual(['m_owner_old'])
  })

  it("honours the admin's choice for the remaining seats and drops people who left", () => {
    const members = [
      member('m_owner', { isOwner: true, canManageBilling: true }),
      member('m_a', { lastActiveAt: '2026-11-17T00:00:00.000Z' }),
      member('m_b'),
    ]
    expect(seatHolderOrder(members, 2, ['m_gone', 'm_b'])).toEqual(['m_owner', 'm_b'])
  })
})

describe('statusComponentOrder', () => {
  it('keeps the first ones in display order: ungrouped first, then each group', () => {
    const components = [
      { id: 'c_g2', groupPosition: 2, position: 0 },
      { id: 'c_g1_b', groupPosition: 1, position: 1 },
      { id: 'c_top_b', groupPosition: null, position: 1 },
      { id: 'c_g1_a', groupPosition: 1, position: 0 },
      { id: 'c_top_a', groupPosition: null, position: 0 },
    ]
    expect(statusComponentOrder(components, 3)).toEqual(['c_top_a', 'c_top_b', 'c_g1_a'])
    expect(statusComponentOrder(components, 2, ['c_g2', 'c_gone'])).toEqual(['c_g2', 'c_top_a'])
  })
})

describe('sendingDomainOrder', () => {
  it('keeps the oldest verified domain by default', () => {
    const domains = [
      { id: 'd_pending_old', status: 'pending', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'd_verified_new', status: 'verified', createdAt: '2026-05-01T00:00:00.000Z' },
      { id: 'd_verified_old', status: 'verified', createdAt: '2026-03-01T00:00:00.000Z' },
    ]
    expect(sendingDomainOrder(domains, 1)).toEqual(['d_verified_old'])
    expect(sendingDomainOrder(domains, 3)).toEqual([
      'd_verified_old',
      'd_verified_new',
      'd_pending_old',
    ])
    expect(sendingDomainOrder(domains, 1, ['d_pending_old'])).toEqual(['d_pending_old'])
  })
})

describe('computePlanLimits: who keeps what', () => {
  it('names the open boards, seat holders, visible components and kept domains only for caps that are over', () => {
    const result = computePlanLimits(
      inputs({
        usage: { ...FITS, maxBoards: 2 },
        candidates: {
          boards: [
            { id: 'b1', postCount: 1, createdAt: '2026-01-01T00:00:00.000Z' },
            { id: 'b2', postCount: 9, createdAt: '2026-02-01T00:00:00.000Z' },
          ],
        },
      }),
      NOW
    )
    expect(result.view.openBoardIds).toEqual(['b2'])
    expect(result.view.keptBoardId).toBe('b2')
    expect(result.view.seatHolderIds).toBeNull()
    expect(result.view.visibleStatusComponentIds).toBeNull()
    expect(result.view.sendingDomainIds).toBeNull()
  })

  it('uses the stored choice', () => {
    const stored: PlanLimitsState = {
      ...computePlanLimits(inputs({ usage: { ...FITS, maxBoards: 2 } }), NOW).nextState!,
      keptBoardId: 'b1',
    }
    const result = computePlanLimits(
      inputs({
        usage: { ...FITS, maxBoards: 2 },
        stored,
        candidates: {
          boards: [
            { id: 'b1', postCount: 1, createdAt: '2026-01-01T00:00:00.000Z' },
            { id: 'b2', postCount: 9, createdAt: '2026-02-01T00:00:00.000Z' },
          ],
        },
      }),
      NOW
    )
    expect(result.view.openBoardIds).toEqual(['b1'])
  })
})

// Keeps the fixture honest: an unknown key in the set must not read as live.
it('treats a missing key in a stored feature set as off', () => {
  const partial = { webhooks: true } as Partial<PlanFeatureSet> as PlanFeatureSet
  expect(
    featureLive(
      { enabled: true, phase: 'grace', features: FREE_FEATURES, fromFeatures: partial },
      'workflows'
    )
  ).toBe(false)
})
