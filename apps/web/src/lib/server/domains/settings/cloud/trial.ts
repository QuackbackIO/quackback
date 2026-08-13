/**
 * Trials: lending a workspace a paid plan before it has bought anything.
 *
 * ## The shape, and why it has no moving parts
 *
 * A trial is one record written once, and a rule applied when the config is
 * read. Nothing ends it; the clock passing `endsAt` is the ending. That is
 * possible because the stored block already describes the workspace *after*
 * the trial the whole time it is running: the stored plan stays Free, the
 * trial sits beside it, and {@link resolveCloudConfig} prefers the trial's
 * plan only while it is in date.
 *
 * Three things follow, and each of them is a bug that does not have to be
 * written:
 *
 * - **No lag.** There is no job, no sweep and no window in which an expired
 *   trial still grants. The workspace-settings cache does not delay it either,
 *   because the cache holds the stored row and the comparison happens after
 *   the read.
 * - **No downgrade write.** Nothing has to run for the plan to become Free, so
 *   there is no failure mode where it did not run.
 * - **No restart.** The record outlives the trial it describes, so a second
 *   attempt finds it and hands out nothing.
 *
 * ## Ending a trial is not a lockout
 *
 * The plan becomes Free and the entitlement gates apply on their own. Free
 * loses paid features; it loses nothing else. Signing in, reading the
 * workspace's own data and exporting it are not entitlements and are not
 * gated, and nothing here suspends, locks or blocks a workspace.
 */

import { logger } from '@/lib/server/logger'
import { ForbiddenError } from '@/lib/shared/errors'
import type { PlanNotice } from '../tier-limits.types'
import { getCloudConfig, writeCloudConfig } from './cloud.service'
import { PLAN_CATALOGUE, type CloudConfig, type CloudTrial, type PlanId } from './cloud.types'

const log = logger.child({ component: 'cloud-trial' })

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The plan a trial lends.
 *
 * Pro rather than the largest plan on the list: a trial should show what the
 * product does, not hand over the enterprise controls a workspace has not
 * asked for. A refusal encountered during the trial then still names a real
 * upgrade (Scale) rather than leaving nothing to sell.
 */
export const TRIAL_PLAN: PlanId = 'pro'

/** How long a trial runs. */
export const TRIAL_DAYS = 14

/**
 * Where a cloud workspace goes to see plans when nobody set `upgradeUrl`.
 *
 * The billing page is the workspace's own upgrade surface. An operator-set
 * `upgradeUrl` still wins — that is the self-host / config-file escape.
 */
export const IN_APP_PLANS_PATH = '/admin/settings/billing'

/** The trial banner and a 402 both send the customer here. */
export function plansActionUrl(config: Pick<CloudConfig, 'enabled' | 'upgradeUrl'>): string | null {
  if (!config.enabled) return null
  return config.upgradeUrl || IN_APP_PLANS_PATH
}

/** Why a workspace was not given a trial. Null when it was. */
export type TrialSkipReason =
  /** Cloud is off, which is every self-hosted install. */
  | 'cloud_disabled'
  /** This workspace has had one. Ending is not the same as being eligible again. */
  | 'already_recorded'
  /** There is a subscription, so the subscription decides the plan. */
  | 'has_subscription'
  /** The write was refused or failed. Recorded, never raised at the customer. */
  | 'refused'

export interface TrialStartResult {
  started: boolean
  reason: TrialSkipReason | null
  /** The trial in force after this call, whether this call created it or not. */
  trial: CloudTrial | null
}

/**
 * Give this workspace a trial, unless it has had one or does not qualify.
 *
 * ## Idempotent by construction, not by checking
 *
 * The window is derived from `anchor` — the moment the workspace finished
 * setting up, which is itself stamped once and never restamped — rather than
 * from the clock at the moment of the call. So calling this twice with the
 * same anchor produces a byte-identical block, which the write seam collapses
 * into a no-op: no second trial, no revision bump, no cache invalidation, and
 * nothing to reason about if two requests race. The `already_recorded` check
 * is what refuses a *different* anchor, which is what "revisit the page a week
 * later" looks like.
 *
 * A workspace with a provider customer but no subscription still qualifies. A
 * customer record is an identity, not a purchase; refusing a trial to someone
 * who once opened a checkout page and closed it would punish the exact
 * hesitation a trial exists to answer.
 */
export async function startTrialIfEligible(opts: { anchor: Date }): Promise<TrialStartResult> {
  const config = await getCloudConfig()

  // First, and before anything is read from the row that could gate: an
  // install that has not opted into cloud has no trials, no countdown and no
  // upsell, ever.
  if (!config.enabled) return { started: false, reason: 'cloud_disabled', trial: null }
  if (config.trial) return { started: false, reason: 'already_recorded', trial: config.trial }
  if (config.billing.subscriptionRef) {
    return { started: false, reason: 'has_subscription', trial: null }
  }

  const trial: CloudTrial = {
    plan: TRIAL_PLAN,
    startedAt: opts.anchor.toISOString(),
    endsAt: new Date(opts.anchor.getTime() + TRIAL_DAYS * DAY_MS).toISOString(),
  }

  try {
    await writeCloudConfig({ trial }, { writer: 'billing' })
  } catch (error) {
    // A trial is worth nobody's error page. This is called as the last step of
    // finishing setup, where the customer is waiting to be let into a
    // workspace they have just built; losing a commercial courtesy is a far
    // smaller harm than losing that. Both refusal shapes are recorded, because
    // a workspace that should have a trial and does not is otherwise
    // invisible.
    if (error instanceof ForbiddenError) {
      log.warn({ err: error }, 'trial not started: the plan block is managed by the config file')
    } else {
      log.error({ err: error }, 'trial not started: the write failed')
    }
    return { started: false, reason: 'refused', trial: null }
  }

  log.info({ plan: trial.plan, endsAt: trial.endsAt }, 'trial started')
  return { started: true, reason: null, trial }
}

/**
 * The banner a trialing workspace sees, or null.
 *
 * Derived from the config rather than written into `tier_limits.notice` at
 * trial start, so it appears and disappears with the trial itself and no
 * second thing has to be cleaned up when the trial ends. It reads
 * `trialActive` rather than comparing dates again: the resolver has already
 * answered that question once against one clock, and a second answer computed
 * here is how a countdown and a gate come to disagree with each other.
 */
export function trialNotice(config: CloudConfig): PlanNotice | null {
  if (!config.enabled || !config.trialActive || !config.trial) return null
  const actionUrl = plansActionUrl(config)
  return {
    label: `${PLAN_CATALOGUE[config.trial.plan].name} trial`,
    message: 'Your workspace moves to the Free plan when this ends. Nothing is deleted.',
    expiresAt: config.trial.endsAt,
    ...(actionUrl ? { actionUrl, actionLabel: 'See plans' } : {}),
  }
}
