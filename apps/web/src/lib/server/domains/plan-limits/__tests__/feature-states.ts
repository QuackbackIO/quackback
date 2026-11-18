/**
 * A stand-in for the plan limits runtime helpers, for suites that test a
 * runtime path rather than the state itself. Each helper answers through the
 * real pure rules (`featureLive`, `featurePaused`) over a view built for the
 * key it is asked about, so a path that asks about the wrong key sees the
 * "included" answer and its pause test fails.
 *
 * The states:
 *  - `flagOff`:  the flag is off and the plan lacks the feature (today's gate).
 *  - `grace`:    over the plan, in the grace, and the feature was live before
 *                (a grace feature stays live; any other key stops at once).
 *  - `enforced`: over the plan, after the grace.
 *  - `included`: the flag is on and the plan includes the feature (an upgrade).
 *
 * The state store itself is covered against a real database in
 * plan-limits.service.db.test.ts and plan-limits.pauses.db.test.ts.
 *
 * Use with:
 *   vi.mock('@/lib/server/domains/plan-limits/plan-limits.service', async () =>
 *     (await import('@/lib/server/domains/plan-limits/__tests__/feature-states')).planLimitsServiceDouble)
 */
import { vi } from 'vitest'
import {
  PLAN_FEATURES,
  PLAN_FEATURE_KEYS,
  type PlanFeatureKey,
  type PlanFeatureSet,
} from '../plan-limits.features'
import { featureLive, featurePaused, type PlanLimitsView } from '../plan-limits.rules'

export type FeatureState = 'flagOff' | 'grace' | 'enforced' | 'included'

export const FEATURE_STATES: readonly FeatureState[] = ['flagOff', 'grace', 'enforced', 'included']

/** The keys the current state applies to; every other key is included in the plan. */
let current: { state: FeatureState; keys: ReadonlySet<PlanFeatureKey> } = {
  state: 'flagOff',
  keys: new Set(),
}

function set(value: boolean): PlanFeatureSet {
  return Object.fromEntries(PLAN_FEATURE_KEYS.map((k) => [k, value])) as PlanFeatureSet
}

/** What the rules record as live at first detection: grace features only. */
function graceSet(): PlanFeatureSet {
  return Object.fromEntries(
    PLAN_FEATURE_KEYS.map((k) => [k, PLAN_FEATURES[k].grace])
  ) as PlanFeatureSet
}

type FeatureView = Pick<PlanLimitsView, 'enabled' | 'phase' | 'features' | 'fromFeatures'>

/** The view a helper sees for `key` under the current state. */
export function featureView(key: PlanFeatureKey): FeatureView {
  if (!current.keys.has(key)) {
    return {
      enabled: current.state !== 'flagOff',
      phase: 'ok',
      features: set(true),
      fromFeatures: null,
    }
  }
  switch (current.state) {
    case 'flagOff':
      return { enabled: false, phase: 'ok', features: set(false), fromFeatures: null }
    case 'grace':
      return { enabled: true, phase: 'grace', features: set(false), fromFeatures: graceSet() }
    case 'enforced':
      return { enabled: true, phase: 'enforced', features: set(false), fromFeatures: graceSet() }
    case 'included':
      return { enabled: true, phase: 'ok', features: set(true), fromFeatures: null }
  }
}

/** Put `keys` in `state` for the helpers below. */
export function setFeatureState(state: FeatureState, ...keys: PlanFeatureKey[]): void {
  current = { state, keys: new Set(keys) }
}

/** The view `getPlanLimits` answers: the flag off, nothing over. */
function flagOffView(): PlanLimitsView {
  return {
    enabled: false,
    phase: 'ok',
    plan: null,
    since: null,
    graceEndsAt: null,
    fromPlan: null,
    issues: [],
    infoRows: [],
    featureIssues: [],
    features: set(true),
    fromFeatures: null,
    openBoardIds: null,
    keptBoardId: null,
    seatHolderIds: null,
    visibleStatusComponentIds: null,
    sendingDomainIds: null,
  }
}

/**
 * Every runtime export of plan-limits.service. The feature helpers follow the
 * state set above; everything else answers as the flag being off (nothing
 * paused, nothing hidden, every list null), so a caller of any helper works.
 * feature-states.test.ts fails when the real module grows an export this lacks.
 */
export const planLimitsServiceDouble = {
  isFeatureLive: vi.fn(async (key: PlanFeatureKey) => featureLive(featureView(key), key)),
  isFeaturePaused: vi.fn(async (key: PlanFeatureKey) => featurePaused(featureView(key), key)),
  getPlanLimits: vi.fn(async (_now?: Date) => flagOffView()),
  getPlanLimitsWithCandidates: vi.fn(async (_now?: Date) => ({
    limits: flagOffView(),
    candidates: {},
  })),
  evaluate: vi.fn(async (_options?: unknown) => ({ view: flagOffView(), snapshot: {} })),
  detectPlanLimits: vi.fn(async (_options?: unknown) => flagOffView()),
  detectPlanLimitsAfterProjectionWrite: vi.fn(
    async (_replaced?: unknown, _appliedAt?: Date) => undefined
  ),
  detectPlanLimitsQuietly: vi.fn(async () => undefined),
  invalidatePlanLimits: vi.fn(async () => undefined),
  isCapEnforced: vi.fn(async (_key?: string) => false),
  openBoardIds: vi.fn(async (): Promise<string[] | null> => null),
  isBoardOpen: vi.fn(async (_boardId?: string) => true),
  seatHolders: vi.fn(async (): Promise<string[] | null> => null),
  isSeatPaused: vi.fn(async (_principalId?: string) => false),
  visibleStatusComponentIds: vi.fn(async (): Promise<string[] | null> => null),
  isStatusComponentVisible: vi.fn(async (_componentId?: string) => true),
  activeSendingDomainIds: vi.fn(async (): Promise<string[] | null> => null),
  isSendingDomainActive: vi.fn(async (_domainId?: string) => true),
}

/** Whether a path should run in `state`, for a path with no plan gate before plan limits. */
export function runsWithoutPlanGate(state: FeatureState): boolean {
  return state !== 'enforced'
}

/** Whether a grace feature's path should run in `state`, for a path that already gated on the plan. */
export function runsWithPlanGate(state: FeatureState): boolean {
  return state === 'grace' || state === 'included'
}
