/**
 * The plan limits state, read and kept current.
 *
 * `getPlanLimits()` is the one reader. It loads its inputs (the effective
 * tier limits, the current plan's features, usage counts, what is set up and
 * the choosers' candidates), runs the pure rules in plan-limits.rules.ts and
 * persists a changed state with a compare-and-set, so detection happens on
 * read. The other detection triggers (a billing projection write, the flag
 * being turned on, the hourly usage-report slot) call `detectPlanLimits()`.
 *
 * Runtime paths ask the narrow helpers below (`isFeatureLive`,
 * `isBoardOpen`, `isSeatPaused`, ...). Each fails open: a read error never
 * blocks a post, a delivery or a sign-in.
 *
 * With the `planLimits` flag off nothing is read beyond the cached settings
 * row and the phase is always ok.
 */
import { CACHE_KEYS, cacheGet, cacheSet } from '@/lib/server/cache'
import { logger } from '@/lib/server/logger'
import { memoizePerRequest, rememberPerRequest } from '@/lib/server/request-memo'
import { getFeatureFlags } from '@/lib/server/domains/settings/settings.service'
import { config } from '@/lib/server/config'
import { isAiClientConfigured } from '@/lib/server/domains/ai/config'
import { getChatModel } from '@/lib/server/domains/ai/models'
import {
  compareAndSetPlanLimitsState,
  readPlanLimitsSources,
  readPlanLimitsStateFresh,
  updatePlanLimitsState,
  type PlanLimitsSources,
} from '@/lib/server/domains/settings/settings.plan-limits'
import { resolveTierLimitsFromRow } from '@/lib/server/domains/settings/tier-limits.service'
import { resolveCloudConfig } from '@/lib/server/domains/settings/cloud/cloud.service'
import { parseBillingProjection } from '@/lib/server/domains/settings/cloud/billing-projection'
import type { StoredCloudConfig, StoredPlanLimitsState } from '@/lib/shared/db-types'
import { loadUsageCounts } from '@/lib/server/domains/billing/usage-counts'
import { invalidatePlanLimits } from './plan-limits.cache'
import {
  PLAN_FEATURES,
  PLAN_FEATURE_KEYS,
  planFeatureSet,
  type PlanFeatureKey,
} from './plan-limits.features'
import {
  computePlanLimits,
  featureLive,
  featurePaused,
  needsUsage,
  parsePlanLimitsState,
  type PlanLimitIssueKey,
  type PlanLimitsInputs,
  type PlanLimitsState,
  type PlanLimitsView,
  type PreviousPlan,
} from './plan-limits.rules'
import {
  loadBoardChoices,
  loadConfiguredFeatures,
  loadMemberChoices,
  loadSendingDomainChoices,
  loadStatusComponentChoices,
  type BoardChoice,
  type MemberChoice,
  type SendingDomainChoice,
  type StatusComponentChoice,
} from './plan-limits.loaders'

export { invalidatePlanLimits }

const log = logger.child({ component: 'plan-limits' })

const INPUTS_TTL_SECONDS = 300
const INPUTS_KEY = CACHE_KEYS.PLAN_LIMITS_INPUTS

/** The plan limits state as every caller sees it. See {@link PlanLimitsView}. */
export type PlanLimits = PlanLimitsView

/** Cached inputs. Each part is loaded the first time something needs it. */
export interface PlanLimitsSnapshot {
  usage?: Record<string, number>
  configured?: Partial<Record<PlanFeatureKey, number>>
  boards?: BoardChoice[]
  members?: MemberChoice[]
  statusComponents?: StatusComponentChoice[]
  sendingDomains?: SendingDomainChoice[]
}

type SnapshotPart = keyof PlanLimitsSnapshot

interface Context {
  enabled: boolean
  sources: PlanLimitsSources | null
  inputs: Omit<PlanLimitsInputs, 'usage' | 'configured' | 'candidates'>
}

/**
 * Everything the rules read comes from one settings row: the limits, the plan,
 * the stored state and its compare-and-set value. That row is the shared
 * settings cache every write drops, so two processes never judge one state
 * against different limits (the per-process tier limits cache is not used).
 */
async function loadContext(now: Date, previous?: PreviousPlan | null): Promise<Context> {
  const [flags, sources] = await Promise.all([getFeatureFlags(), readPlanLimitsSources()])
  const limits = resolveTierLimitsFromRow(
    sources?.tierLimits ?? null,
    sources?.cloud?.projection ?? null,
    now
  )
  const cloud = resolveCloudConfig(sources?.cloud ?? null, now)
  return {
    enabled: flags.planLimits === true,
    sources,
    inputs: {
      enabled: flags.planLimits === true,
      basis: {
        cloudRevision: sources?.cloudRevision ?? 0,
        authConfigVersion: sources?.authConfigVersion ?? 0,
      },
      plan: cloud.plan,
      limits,
      features: planFeatureSet(limits.features, cloud),
      stored: parsePlanLimitsState(sources?.planLimitsState),
      previous: previous !== undefined ? previous : previousFromSources(sources, now),
    },
  }
}

/**
 * The plan in force just before a projection term lapsed, read from the
 * stored projection, which still carries it. Null when nothing has lapsed.
 */
function previousFromSources(sources: PlanLimitsSources | null, now: Date): PreviousPlan | null {
  const projection = parseBillingProjection(sources?.cloud?.projection)
  if (!sources || !projection?.planLimitsExpireAt) return null
  const lapsedAt = Date.parse(projection.planLimitsExpireAt)
  if (now.getTime() < lapsedAt) return null
  return previousPlanAt(sources, sources.cloud, new Date(lapsedAt - 1))
}

function previousPlanAt(
  sources: Pick<PlanLimitsSources, 'tierLimits'>,
  cloud: StoredCloudConfig | null,
  at: Date
): PreviousPlan {
  const limits = resolveTierLimitsFromRow(sources.tierLimits, cloud?.projection ?? null, at)
  const config = resolveCloudConfig(cloud, at)
  return { plan: config.plan, features: planFeatureSet(limits.features, config) }
}

async function readSnapshot(): Promise<PlanLimitsSnapshot> {
  return (await memoizePerRequest(INPUTS_KEY, () => cacheGet<PlanLimitsSnapshot>(INPUTS_KEY))) ?? {}
}

/**
 * The check the assistant and article translation make before a model call:
 * an AI client and the feature's chat model. A config that cannot load runs
 * no model.
 */
function modelConfigured(feature: 'assistant' | 'helpCenterTranslate'): boolean {
  try {
    return (
      isAiClientConfigured(config.openaiApiKey, config.openaiBaseUrl) &&
      getChatModel(feature) !== null
    )
  } catch {
    return false
  }
}

async function loadPart(
  part: SnapshotPart,
  sources: PlanLimitsSources | null,
  stored: PlanLimitsState | null
): Promise<Partial<PlanLimitsSnapshot>> {
  switch (part) {
    case 'usage':
      return { usage: await loadUsageCounts() }
    case 'configured': {
      return {
        configured: await loadConfiguredFeatures({
          customCss: sources?.customCss ?? null,
          liveCustomDomains: sources?.liveCustomDomains ?? [],
          autoTranslate: sources?.autoTranslate ?? false,
          assistantResponds: sources?.assistantResponds ?? false,
          visitorChatLive: sources?.visitorChatLive ?? false,
          assistantModel: modelConfigured('assistant'),
          translationModel: modelConfigured('helpCenterTranslate'),
        }),
      }
    }
    case 'boards':
      return { boards: await loadBoardChoices() }
    case 'members': {
      const graceEnd = stored ? new Date(stored.graceEndsAt) : null
      return { members: await loadMemberChoices(graceEnd) }
    }
    case 'statusComponents':
      return { statusComponents: await loadStatusComponentChoices() }
    case 'sendingDomains':
      return { sendingDomains: await loadSendingDomainChoices() }
  }
}

/** The snapshot with every part in `parts` present, loading and caching what is missing. */
async function snapshotWith(
  parts: readonly SnapshotPart[],
  sources: PlanLimitsSources | null,
  stored: PlanLimitsState | null
): Promise<PlanLimitsSnapshot> {
  const snapshot = await readSnapshot()
  const missing = parts.filter((part) => snapshot[part] === undefined)
  if (missing.length === 0) return snapshot
  const loaded = await Promise.all(missing.map((part) => loadPart(part, sources, stored)))
  const merged: PlanLimitsSnapshot = Object.assign({}, snapshot, ...loaded)
  await cacheSet(INPUTS_KEY, merged, INPUTS_TTL_SECONDS)
  rememberPerRequest(INPUTS_KEY, merged)
  return merged
}

const CANDIDATE_PART: Partial<Record<PlanLimitIssueKey, SnapshotPart>> = {
  maxBoards: 'boards',
  maxTeamSeats: 'members',
  maxStatusComponents: 'statusComponents',
  maxSendingDomains: 'sendingDomains',
}

export interface Evaluation {
  view: PlanLimitsView
  snapshot: PlanLimitsSnapshot
}

/** @internal The evaluation with its inputs, for the choosers. */
export async function evaluate(options: {
  now: Date
  previous?: PreviousPlan | null
  persist: boolean
}): Promise<Evaluation> {
  const { now } = options
  const context = await loadContext(now, options.previous)
  const base = { ...context.inputs, usage: null, configured: null, candidates: {} }

  if (!needsUsage(context.inputs)) {
    const result = computePlanLimits(base, now)
    if (result.changed && options.persist) {
      await persist(context.sources?.planLimitsState ?? null, result.nextState)
    }
    return { view: result.view, snapshot: {} }
  }

  const featuresOff = Object.values(context.inputs.features).some((on) => !on)
  let snapshot = await snapshotWith(
    featuresOff ? ['usage', 'configured'] : ['usage'],
    context.sources,
    context.inputs.stored
  )
  const toInputs = (s: PlanLimitsSnapshot): PlanLimitsInputs => ({
    ...base,
    usage: s.usage ?? null,
    configured: s.configured ?? null,
    candidates: {
      boards: s.boards,
      members: s.members,
      statusComponents: s.statusComponents,
      sendingDomains: s.sendingDomains,
    },
  })
  let result = computePlanLimits(toInputs(snapshot), now)
  const needed = result.view.issues
    .map((issue) => CANDIDATE_PART[issue.key])
    .filter((part): part is SnapshotPart => part !== undefined)
  if (needed.some((part) => snapshot[part] === undefined)) {
    snapshot = await snapshotWith(needed, context.sources, context.inputs.stored)
    result = computePlanLimits(toInputs(snapshot), now)
  }

  if (result.changed && options.persist) {
    const won = await persist(context.sources?.planLimitsState ?? null, result.nextState)
    if (!won) {
      // Another process wrote first: its state stands. Recompute from it.
      const fresh = parsePlanLimitsState(await readPlanLimitsStateFresh())
      result = computePlanLimits({ ...toInputs(snapshot), stored: fresh }, now)
    }
  }
  return { view: result.view, snapshot }
}

async function persist(expected: unknown, next: PlanLimitsState | null): Promise<boolean> {
  try {
    const won = await compareAndSetPlanLimitsState(
      expected,
      next as unknown as StoredPlanLimitsState | null
    )
    if (won) {
      log.info(
        { since: next?.since ?? null, graceEndsAt: next?.graceEndsAt ?? null },
        next ? 'plan limits state stored' : 'plan limits state cleared'
      )
    }
    return won
  } catch (err) {
    // Fail open: the read still answers from what it computed, and the next
    // read or the hourly slot writes the state again. Counting the failure as
    // lost would only re-read a state that could not be written.
    log.error({ err }, 'plan limits state write failed')
    return true
  }
}

/**
 * The workspace's plan limits now. Detects on read: a first time over the
 * limits starts the grace, and a state that no longer applies is cleared.
 */
export async function getPlanLimits(now: Date = new Date()): Promise<PlanLimits> {
  return (await evaluate({ now, persist: true })).view
}

/** {@link getPlanLimits} plus the choosers' candidate lists, for the Plan limits page. */
export async function getPlanLimitsWithCandidates(now: Date = new Date()): Promise<{
  limits: PlanLimits
  candidates: Pick<PlanLimitsSnapshot, 'boards' | 'members' | 'statusComponents' | 'sendingDomains'>
}> {
  const { view, snapshot } = await evaluate({ now, persist: true })
  return {
    limits: view,
    candidates: {
      boards: snapshot.boards,
      members: snapshot.members,
      statusComponents: snapshot.statusComponents,
      sendingDomains: snapshot.sendingDomains,
    },
  }
}

/**
 * Recount and detect now. `previous` is the plan in force before a change the
 * caller just made (a billing projection write), so its live features carry
 * through the grace; omitted, a lapsed term's plan is read from the stored
 * projection.
 */
export async function detectPlanLimits(
  options: { previous?: PreviousPlan | null; now?: Date } = {}
): Promise<PlanLimits> {
  await invalidatePlanLimits()
  return (
    await evaluate({ now: options.now ?? new Date(), previous: options.previous, persist: true })
  ).view
}

/**
 * Detection after a billing projection write: the projection it replaced is
 * the plan before the drop. `appliedAt` is when the write began.
 *
 * A read can race the write and store the grace first, without the plan
 * before (it cannot know it). A grace that began at or after `appliedAt` and
 * has no plan before gets this one merged in under the row lock, so the
 * replaced plan's live features still carry through the grace.
 *
 * Never throws; a failure is logged and the next read detects instead.
 */
export async function detectPlanLimitsAfterProjectionWrite(
  replacedProjection: unknown,
  appliedAt: Date = new Date()
): Promise<void> {
  try {
    const now = new Date()
    const sources = await readPlanLimitsSources()
    let previous: PreviousPlan | null = null
    const replaced = parseBillingProjection(replacedProjection)
    if (sources && replaced) {
      const lapsedAt = replaced.planLimitsExpireAt ? Date.parse(replaced.planLimitsExpireAt) : null
      const at = lapsedAt !== null && lapsedAt <= now.getTime() ? new Date(lapsedAt - 1) : now
      previous = previousPlanAt(
        sources,
        { enabled: true, projection: replacedProjection as never },
        at
      )
    }
    await detectPlanLimits({ previous, now })
    if (previous) await mergePreviousPlan(previous, appliedAt)
  } catch (err) {
    log.error({ err }, 'plan limits detection after a projection write failed')
  }
}

async function mergePreviousPlan(previous: PreviousPlan, appliedAt: Date): Promise<void> {
  const wrote = await updatePlanLimitsState((current) => {
    const state = parsePlanLimitsState(current)
    if (!state || state.fromPlan !== null) return undefined
    if (Date.parse(state.since) < appliedAt.getTime()) return undefined
    const fromFeatures = { ...state.fromFeatures }
    for (const key of PLAN_FEATURE_KEYS) {
      if (PLAN_FEATURES[key].grace && previous.features[key]) fromFeatures[key] = true
    }
    const merged: PlanLimitsState = { ...state, fromPlan: previous.plan, fromFeatures }
    return merged as unknown as StoredPlanLimitsState
  })
  if (wrote) await invalidatePlanLimits()
}

/** {@link detectPlanLimits} that never throws, for background triggers. */
export async function detectPlanLimitsQuietly(): Promise<void> {
  try {
    await detectPlanLimits()
  } catch (err) {
    log.warn({ err }, 'plan limits detection failed')
  }
}

// ---------------------------------------------------------------------------
// Runtime helpers. Each fails open.
// ---------------------------------------------------------------------------

async function viewOrNull(): Promise<PlanLimits | null> {
  try {
    return await getPlanLimits()
  } catch (err) {
    log.error({ err }, 'plan limits read failed; failing open')
    return null
  }
}

/**
 * Whether a paid feature may run now: the current plan has it, or the phase
 * is grace and it was live at first detection. With the flag off this is the
 * current plan's grant alone, the same answer as today's plan gates.
 *
 * Use it where a runtime path already gates on the plan (the assistant,
 * article translation, MCP). Where a path runs with no plan gate today, use
 * {@link isFeaturePaused}, which is false with the flag off.
 */
export async function isFeatureLive(key: PlanFeatureKey): Promise<boolean> {
  const view = await viewOrNull()
  return view ? featureLive(view, key) : true
}

/** True only with the flag on, when the feature is not live (see {@link isFeatureLive}). */
export async function isFeaturePaused(key: PlanFeatureKey): Promise<boolean> {
  const view = await viewOrNull()
  return view ? featurePaused(view, key) : false
}

function enforcedOver(view: PlanLimits | null, key: PlanLimitIssueKey): boolean {
  return (
    view !== null &&
    view.enabled &&
    view.phase === 'enforced' &&
    view.issues.some((i) => i.key === key)
  )
}

/** Whether a cap's excess is frozen now (custom roles, help center languages, ...). */
export async function isCapEnforced(key: PlanLimitIssueKey): Promise<boolean> {
  return enforcedOver(await viewOrNull(), key)
}

/** Boards that stay open, or null when every board is open. */
export async function openBoardIds(): Promise<string[] | null> {
  const view = await viewOrNull()
  return enforcedOver(view, 'maxBoards') ? view!.openBoardIds : null
}

/** False only after grace, for a board over the cap that is not kept open. */
export async function isBoardOpen(boardId: string): Promise<boolean> {
  const open = await openBoardIds()
  return open === null || open.includes(boardId)
}

/** Members who keep a seat, or null when every member does. */
export async function seatHolders(): Promise<string[] | null> {
  const view = await viewOrNull()
  return enforcedOver(view, 'maxTeamSeats') ? view!.seatHolderIds : null
}

/**
 * True only after grace, for a team member (a seat) without a seat holder's
 * place. Anyone who is not a seat (a service principal behind an API key, a
 * portal user) is never paused by this.
 */
export async function isSeatPaused(principalId: string): Promise<boolean> {
  try {
    const { view, snapshot } = await evaluate({ now: new Date(), persist: true })
    if (!enforcedOver(view, 'maxTeamSeats') || !view.seatHolderIds) return false
    const isSeat = snapshot.members?.some((m) => m.id === principalId) ?? false
    return isSeat && !view.seatHolderIds.includes(principalId)
  } catch (err) {
    log.error({ err }, 'plan limits read failed; failing open')
    return false
  }
}

/** Status components the public page shows, or null when it shows them all. */
export async function visibleStatusComponentIds(): Promise<string[] | null> {
  const view = await viewOrNull()
  return enforcedOver(view, 'maxStatusComponents') ? view!.visibleStatusComponentIds : null
}

export async function isStatusComponentVisible(componentId: string): Promise<boolean> {
  const visible = await visibleStatusComponentIds()
  return visible === null || visible.includes(componentId)
}

/** Sending domains that keep sending, or null when they all do. */
export async function activeSendingDomainIds(): Promise<string[] | null> {
  const view = await viewOrNull()
  return enforcedOver(view, 'maxSendingDomains') ? view!.sendingDomainIds : null
}

/** False only after grace, for a sending domain over the cap that is not kept. */
export async function isSendingDomainActive(domainId: string): Promise<boolean> {
  const active = await activeSendingDomainIds()
  return active === null || active.includes(domainId)
}
