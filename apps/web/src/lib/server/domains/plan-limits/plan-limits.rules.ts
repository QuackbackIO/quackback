/**
 * The plan limits rules, as pure functions of (inputs, now).
 *
 * A workspace is over its plan when a numeric cap that needs a fix is
 * exceeded, or a paid feature is set up that its plan does not include. The
 * first time it is seen over, a 7-day grace starts. During grace everything
 * that already exists keeps working, including the live features of the plan
 * before the drop. After grace the excess is frozen at read time; nothing is
 * deleted and nothing is written to the frozen records.
 *
 * One grace per drop: the stored state names the limits it was granted
 * against (`limitsKey`). Going back over the same limits after the grace
 * ended finds the same state and is enforced at once. Only a change of plan,
 * caps or features starts a new grace.
 *
 * The database layer (plan-limits.service.ts) loads the inputs and persists
 * `nextState` when `changed` is true.
 */

import {
  capIssues,
  type PlanCapInfo,
  type PlanCapKey,
  type PlanDowngradeIssue,
} from '@/lib/shared/billing/plan-downgrade'
import type { TierLimits } from '@/lib/server/domains/settings/tier-limits.types'
import { isPlanId, type PlanId } from '@/lib/server/domains/settings/cloud/cloud.types'
import {
  guaranteedSeatHolders,
  openBoardOrder,
  seatHolderOrder,
  sendingDomainOrder,
  statusComponentOrder,
  type BoardCandidate,
  type MemberCandidate,
  type SendingDomainCandidate,
  type StatusComponentCandidate,
} from './plan-limits.order'
import {
  PLAN_FEATURES,
  PLAN_FEATURE_KEYS,
  type PlanFeatureKey,
  type PlanFeatureSet,
} from './plan-limits.features'

export const PLAN_LIMITS_GRACE_MS = 7 * 24 * 60 * 60 * 1000

export {
  guaranteedSeatHolders,
  openBoardOrder,
  seatHolderOrder,
  sendingDomainOrder,
  statusComponentOrder,
  type BoardCandidate,
  type MemberCandidate,
  type SendingDomainCandidate,
  type StatusComponentCandidate,
}

export type PlanLimitsPhase = 'ok' | 'grace' | 'enforced'

/**
 * Caps that need a fix. Posts, status subscribers and inbound addresses are
 * never taken away, so they are information rows instead.
 */
export const PLAN_LIMIT_ISSUE_KEYS = [
  'maxBoards',
  'maxTeamSeats',
  'maxStatusComponents',
  'maxCustomRoles',
  'maxSendingDomains',
  'maxHelpCenterLocales',
] as const satisfies readonly PlanCapKey[]

export type PlanLimitIssueKey = (typeof PLAN_LIMIT_ISSUE_KEYS)[number]

/** Caps shown when over, with no fix: existing items always stay. */
export const PLAN_LIMIT_INFO_CAP_KEYS = [
  'maxPosts',
  'maxInboundEmailAddresses',
  'maxStatusSubscribers',
] as const satisfies readonly PlanCapKey[]

/** Monthly meters shown once used up. They have no grace. */
export const PLAN_LIMIT_METER_KEYS = ['aiTokensPerMonth', 'emailsPerMonth'] as const

export type PlanLimitMeterKey = (typeof PLAN_LIMIT_METER_KEYS)[number]

const METER_MESSAGE: Record<PlanLimitMeterKey, string> = {
  aiTokensPerMonth: 'AI usage for this month is used up',
  emailsPerMonth: 'Emails for this month are used up',
}

export type PlanLimitIssue = PlanDowngradeIssue & { key: PlanLimitIssueKey }

export type PlanLimitInfoRow =
  PlanCapInfo | { key: PlanLimitMeterKey; used: number; cap: number; message: string }

/** A paid feature that is set up but not in the current plan. */
export interface PlanFeatureIssue {
  key: PlanFeatureKey
  /** How many of it are set up: live workflows, enabled endpoints, and so on. */
  count: number
}

/** Paid features the database layer counts, so the page can say what pauses. */
export type ConfiguredFeatures = Partial<Record<PlanFeatureKey, number>>

/** The stored state. Absent (null) means the workspace has never been over these limits. */
export interface PlanLimitsState {
  /** First time seen over these limits, ISO. */
  since: string
  /** `since` + 7 days, ISO. */
  graceEndsAt: string
  /** The plan before the drop, when known. For copy only. */
  fromPlan: PlanId | null
  /** Grace features live at first detection; read only during grace. */
  fromFeatures: PlanFeatureSet
  /** Identity of the limits this grace was granted against (see {@link limitsKeyFor}). */
  limitsKey: string
  /** The admin's choice of the board that stays open. */
  keptBoardId?: string
  /** The admin's choice of who keeps a seat. */
  seatHolderIds?: string[]
  /** The admin's choice of status components that stay on the public page. */
  visibleStatusComponentIds?: string[]
  /** The admin's choice of sending domains that keep sending. */
  sendingDomainIds?: string[]
}

export interface PlanLimitsCandidates {
  boards?: readonly BoardCandidate[]
  members?: readonly MemberCandidate[]
  statusComponents?: readonly StatusComponentCandidate[]
  sendingDomains?: readonly SendingDomainCandidate[]
}

/** The plan before a drop, when the caller knows it (a projection write, a lapsed term). */
export interface PreviousPlan {
  plan: PlanId | null
  features: PlanFeatureSet
}

export interface PlanLimitsInputs {
  /** The rollout flag. Off: always ok, nothing stored. */
  enabled: boolean
  plan: PlanId | null
  /** The effective limits now. */
  limits: TierLimits
  /** The current plan's features. */
  features: PlanFeatureSet
  /** From `loadUsageCounts()`. Null when {@link needsUsage} said none is needed. */
  usage: Record<string, number> | null
  configured: ConfiguredFeatures | null
  stored: PlanLimitsState | null
  previous: PreviousPlan | null
  candidates: PlanLimitsCandidates
}

export interface PlanLimitsView {
  enabled: boolean
  phase: PlanLimitsPhase
  plan: PlanId | null
  /** Null when the phase is ok. */
  since: string | null
  graceEndsAt: string | null
  fromPlan: PlanId | null
  issues: PlanLimitIssue[]
  infoRows: PlanLimitInfoRow[]
  featureIssues: PlanFeatureIssue[]
  features: PlanFeatureSet
  /** Null outside grace and enforcement. */
  fromFeatures: PlanFeatureSet | null
  /** Boards that stay open. Null when boards are not over (every board is open). */
  openBoardIds: string[] | null
  keptBoardId: string | null
  /** Members who keep a seat. Null when seats are not over. */
  seatHolderIds: string[] | null
  /** Components that stay on the public page. Null when they are not over. */
  visibleStatusComponentIds: string[] | null
  /** Sending domains that keep sending. Null when they are not over. */
  sendingDomainIds: string[] | null
}

export interface PlanLimitsResult {
  view: PlanLimitsView
  nextState: PlanLimitsState | null
  /** Whether `nextState` differs from the stored state and must be written. */
  changed: boolean
}

function okView(input: Pick<PlanLimitsInputs, 'enabled' | 'plan' | 'features'>): PlanLimitsView {
  return {
    enabled: input.enabled,
    phase: 'ok',
    plan: input.plan,
    since: null,
    graceEndsAt: null,
    fromPlan: null,
    issues: [],
    infoRows: [],
    featureIssues: [],
    features: input.features,
    fromFeatures: null,
    openBoardIds: null,
    keptBoardId: null,
    seatHolderIds: null,
    visibleStatusComponentIds: null,
    sendingDomainIds: null,
  }
}

/**
 * Whether anything can be over: some counted cap is finite or some feature is
 * off. False on an install without plan billing, so it never reads usage.
 */
export function needsUsage(
  input: Pick<PlanLimitsInputs, 'enabled' | 'limits' | 'features'>
): boolean {
  if (!input.enabled) return false
  const keys = [...PLAN_LIMIT_ISSUE_KEYS, ...PLAN_LIMIT_INFO_CAP_KEYS, ...PLAN_LIMIT_METER_KEYS]
  if (keys.some((key) => input.limits[key] !== null)) return true
  return PLAN_FEATURE_KEYS.some((key) => !input.features[key])
}

/**
 * Identity of a set of limits: the plan, the caps that need a fix, and the
 * grace features that are off (the only ones that can raise a feature issue).
 * A grace belongs to one of these, so a change that cannot put the workspace
 * over (a meter, an at-once feature such as AI drafts) never starts another.
 */
export function limitsKeyFor(
  plan: PlanId | null,
  limits: TierLimits,
  features: PlanFeatureSet
): string {
  const caps = PLAN_LIMIT_ISSUE_KEYS.map((key) => limits[key])
  const off = PLAN_FEATURE_KEYS.filter((key) => PLAN_FEATURES[key].grace && !features[key])
  return JSON.stringify([plan, caps, off])
}

function infoRows(used: Record<string, number>, limits: TierLimits): PlanLimitInfoRow[] {
  const rows: PlanLimitInfoRow[] = capIssues(used, limits, PLAN_LIMIT_INFO_CAP_KEYS).map(
    ({ key, used: count, cap, message }) => ({ key, used: count, cap, message })
  )
  for (const key of PLAN_LIMIT_METER_KEYS) {
    const cap = limits[key]
    const count = used[key] ?? 0
    if (cap !== null && cap > 0 && count >= cap) {
      rows.push({ key, used: count, cap, message: METER_MESSAGE[key] })
    }
  }
  return rows
}

function featureIssuesFor(
  features: PlanFeatureSet,
  configured: ConfiguredFeatures | null
): PlanFeatureIssue[] {
  if (!configured) return []
  const issues: PlanFeatureIssue[] = []
  for (const key of PLAN_FEATURE_KEYS) {
    const count = configured[key] ?? 0
    if (count > 0 && !features[key]) issues.push({ key, count })
  }
  return issues
}

/**
 * Grace features live at first detection: what the plan before had, what the
 * current plan has, and what is set up and running. A feature that stops at
 * once on a drop is never carried.
 */
function graceFeatures(
  features: PlanFeatureSet,
  previous: PreviousPlan | null,
  configured: ConfiguredFeatures | null
): PlanFeatureSet {
  const set = {} as PlanFeatureSet
  for (const key of PLAN_FEATURE_KEYS) {
    set[key] =
      PLAN_FEATURES[key].grace &&
      (features[key] || previous?.features[key] === true || (configured?.[key] ?? 0) > 0)
  }
  return set
}

export function computePlanLimits(input: PlanLimitsInputs, now: Date): PlanLimitsResult {
  if (!input.enabled) {
    return { view: okView(input), nextState: null, changed: input.stored !== null }
  }

  const key = limitsKeyFor(input.plan, input.limits, input.features)
  const sameLimits = input.stored !== null && input.stored.limitsKey === key
  const used = input.usage ?? {}
  const issues = capIssues(used, input.limits, PLAN_LIMIT_ISSUE_KEYS) as PlanLimitIssue[]
  const featureIssues = featureIssuesFor(input.features, input.configured)
  const rows = infoRows(used, input.limits)

  if (issues.length === 0 && featureIssues.length === 0) {
    // A state for these same limits stays, so going back over them later
    // finds the grace already spent.
    const nextState = sameLimits ? input.stored : null
    return {
      view: { ...okView(input), infoRows: rows },
      nextState,
      changed: nextState !== input.stored,
    }
  }

  const nextState: PlanLimitsState = sameLimits
    ? input.stored!
    : {
        since: now.toISOString(),
        graceEndsAt: new Date(now.getTime() + PLAN_LIMITS_GRACE_MS).toISOString(),
        fromPlan: input.previous?.plan ?? null,
        fromFeatures: graceFeatures(input.features, input.previous, input.configured),
        limitsKey: key,
        ...choicesOf(input.stored),
      }
  const phase: PlanLimitsPhase =
    now.getTime() < Date.parse(nextState.graceEndsAt) ? 'grace' : 'enforced'

  const over = new Set(issues.map((issue) => issue.key))
  const cap = (k: PlanLimitIssueKey) => input.limits[k] ?? 0
  const { boards, members, statusComponents, sendingDomains } = input.candidates
  const openBoardIds =
    over.has('maxBoards') && boards
      ? openBoardOrder(boards, cap('maxBoards'), nextState.keptBoardId)
      : null

  return {
    view: {
      enabled: true,
      phase,
      plan: input.plan,
      since: nextState.since,
      graceEndsAt: nextState.graceEndsAt,
      fromPlan: nextState.fromPlan,
      issues,
      infoRows: rows,
      featureIssues,
      features: input.features,
      fromFeatures: nextState.fromFeatures,
      openBoardIds,
      keptBoardId: openBoardIds?.[0] ?? null,
      seatHolderIds:
        over.has('maxTeamSeats') && members
          ? seatHolderOrder(members, cap('maxTeamSeats'), nextState.seatHolderIds)
          : null,
      visibleStatusComponentIds:
        over.has('maxStatusComponents') && statusComponents
          ? statusComponentOrder(
              statusComponents,
              cap('maxStatusComponents'),
              nextState.visibleStatusComponentIds
            )
          : null,
      sendingDomainIds:
        over.has('maxSendingDomains') && sendingDomains
          ? sendingDomainOrder(sendingDomains, cap('maxSendingDomains'), nextState.sendingDomainIds)
          : null,
    },
    nextState,
    changed: nextState !== input.stored,
  }
}

function choicesOf(state: PlanLimitsState | null): Partial<PlanLimitsState> {
  if (!state) return {}
  const choices: Partial<PlanLimitsState> = {}
  if (state.keptBoardId) choices.keptBoardId = state.keptBoardId
  if (state.seatHolderIds) choices.seatHolderIds = state.seatHolderIds
  if (state.visibleStatusComponentIds) {
    choices.visibleStatusComponentIds = state.visibleStatusComponentIds
  }
  if (state.sendingDomainIds) choices.sendingDomainIds = state.sendingDomainIds
  return choices
}

/**
 * Whether a feature may run now: the current plan has it, or the phase is
 * grace and it was live at first detection. With the flag off this is the
 * current plan alone.
 */
export function featureLive(
  view: Pick<PlanLimitsView, 'enabled' | 'phase' | 'features' | 'fromFeatures'>,
  key: PlanFeatureKey
): boolean {
  if (view.features[key]) return true
  if (!view.enabled) return false
  return view.phase === 'grace' && view.fromFeatures?.[key] === true
}

// ---------------------------------------------------------------------------
// Stored state
// ---------------------------------------------------------------------------

function isIso(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === 'string')
}

/** Read a stored state, or null when absent or malformed. */
export function parsePlanLimitsState(value: unknown): PlanLimitsState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (!isIso(raw.since) || !isIso(raw.graceEndsAt) || typeof raw.limitsKey !== 'string') {
    return null
  }
  const storedFeatures =
    raw.fromFeatures && typeof raw.fromFeatures === 'object'
      ? (raw.fromFeatures as Record<string, unknown>)
      : {}
  const fromFeatures = {} as PlanFeatureSet
  for (const key of PLAN_FEATURE_KEYS) fromFeatures[key] = storedFeatures[key] === true
  const state: PlanLimitsState = {
    since: raw.since,
    graceEndsAt: raw.graceEndsAt,
    fromPlan: typeof raw.fromPlan === 'string' && isPlanId(raw.fromPlan) ? raw.fromPlan : null,
    fromFeatures,
    limitsKey: raw.limitsKey,
  }
  if (typeof raw.keptBoardId === 'string') state.keptBoardId = raw.keptBoardId
  const seats = stringList(raw.seatHolderIds)
  if (seats) state.seatHolderIds = seats
  const components = stringList(raw.visibleStatusComponentIds)
  if (components) state.visibleStatusComponentIds = components
  const domains = stringList(raw.sendingDomainIds)
  if (domains) state.sendingDomainIds = domains
  return state
}
