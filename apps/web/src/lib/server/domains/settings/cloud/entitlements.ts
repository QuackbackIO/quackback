/**
 * The entitlement gate: `requireEntitlement()` and friends.
 *
 * Sits *alongside* the numeric helpers in `tier-enforce.ts`, never in front of
 * them. A call site that needs both asks both:
 *
 * ```ts
 * await requireEntitlement('aiAssistant')  // does the plan include it?
 * await enforceAiTokenBudget()             // is there budget left?
 * ```
 *
 * The difference that matters: the numeric refusal can only say *"you have hit
 * a limit"*, because `tier_limits` does not record which plan produced its
 * numbers. This one says *"that is a Pro feature"*, because the plan is
 * modelled.
 */

import { EntitlementRequiredError } from '@/lib/server/errors/entitlement-error'
import { getCloudConfig } from './cloud.service'
import { plansActionUrl } from './commercial-notice'
import {
  ENTITLEMENTS,
  ENTITLEMENT_KEYS,
  PLAN_CATALOGUE,
  minimumPlanFor,
  type CloudConfig,
  type EntitlementKey,
} from './cloud.types'

/**
 * Is `key` granted under `config`? Pure — the resolution rule in one place.
 *
 * Order of precedence:
 *   1. Cloud disabled  -> granted. Always. This is the default-off guarantee,
 *      and it is checked before anything else so no stored value, malformed or
 *      otherwise, can gate an install that has not opted in.
 *   2. The projected entitlement value. The control plane is authoritative;
 *      the local plan catalogue is display metadata and never grants access.
 */
export function isEntitled(config: CloudConfig, key: EntitlementKey): boolean {
  if (!config.enabled) return true
  return config.entitlements[key] === true
}

/** Non-throwing check, for rendering a surface as locked rather than refusing. */
export async function hasEntitlement(key: EntitlementKey): Promise<boolean> {
  return isEntitled(await getCloudConfig(), key)
}

/**
 * Every entitlement's current state. Feeds an admin/plan surface that wants to
 * show what is and is not included without a call per key. All true on an
 * unconfigured install.
 */
export async function listEntitlements(): Promise<Record<EntitlementKey, boolean>> {
  const config = await getCloudConfig()
  const out = {} as Record<EntitlementKey, boolean>
  for (const key of ENTITLEMENT_KEYS) out[key] = isEntitled(config, key)
  return out
}

/**
 * Refuse unless the workspace's plan includes `key`.
 *
 * Returns silently — with no database read beyond the already-cached settings
 * blob — on any install where cloud config is absent or disabled, which is
 * every self-hosted install and every workspace that predates the migration.
 *
 * @throws EntitlementRequiredError (HTTP 402) naming the plan that would grant it.
 */
export async function requireEntitlement(key: EntitlementKey): Promise<void> {
  const config = await getCloudConfig()
  if (isEntitled(config, key)) return
  throw buildRefusal(config, key)
}

/**
 * Build the refusal for `key` under `config`. Exported so the copy can be
 * asserted directly, and so a UI surface can render the same upgrade prompt it
 * would get from a 402 without provoking one.
 */
export function buildRefusal(config: CloudConfig, key: EntitlementKey): EntitlementRequiredError {
  const definition = ENTITLEMENTS[key]
  const current = config.plan ? PLAN_CATALOGUE[config.plan] : null
  const cheapest = minimumPlanFor(key)
  // An explicit `false` override can deny a feature the workspace's own plan
  // grants. Naming a plan the workspace already has (or has outgrown) would be
  // a nonsense upsell, so in that case the refusal reports no required plan
  // and the copy degrades to "contact us" instead.
  const required = cheapest && current && cheapest.rank <= current.rank ? null : cheapest
  const upgradeUrl = plansActionUrl(config)
  return new EntitlementRequiredError({
    entitlement: key,
    friendly: definition.friendly,
    friendlyIsPlural: definition.plural,
    requiredPlanArticle: required?.article ?? null,
    currentPlan: current?.id ?? null,
    currentPlanName: current?.name ?? null,
    requiredPlan: required?.id ?? null,
    requiredPlanName: required?.name ?? null,
    ...(upgradeUrl ? { upgradeUrl } : {}),
  })
}
