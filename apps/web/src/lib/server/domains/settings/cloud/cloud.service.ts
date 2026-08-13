import type { StoredCloudConfig } from '@/lib/shared/db-types'
import { db, eq, settings } from '@/lib/server/db'
import { bumpAuthConfigVersionInTx } from '@/lib/server/auth/config-version'
import { logger } from '@/lib/server/logger'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { isPathManaged } from '@/lib/server/config-file/managed-paths'
import { invalidateSettingsCache } from '../settings.helpers'
import {
  cloudConfigEquivalent,
  cloudPatchPaths,
  mergeCloudConfig,
  type CloudConfigPatch,
} from './cloud.merge'
import {
  BILLING_STATUSES,
  DISABLED_CLOUD_CONFIG,
  EMPTY_BILLING,
  PLAN_CATALOGUE,
  isEntitlementKey,
  isPlanId,
  type BillingStatus,
  type CloudBilling,
  type CloudConfig,
  type CloudTrial,
  type CloudWriter,
  type EntitlementKey,
  type PlanId,
} from './cloud.types'

export type { CloudConfigPatch } from './cloud.merge'
export { CLOUD_MANAGED_PATHS, cloudPatchPaths, mergeCloudConfig } from './cloud.merge'

const log = logger.child({ component: 'cloud-config' })

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Stored JSON -> resolved config. Pure, total, and biased toward *disabled*.
 *
 * Anything that is not an explicit, well-formed `enabled: true` resolves to
 * {@link DISABLED_CLOUD_CONFIG}. That bias is deliberate and is the mechanism
 * behind the default-off guarantee: a NULL column, an empty object, a
 * hand-edited row, a value written by a future schema version this code does
 * not understand — all of them land on "no plan, no gating, no upsell", which
 * is today's behaviour.
 *
 * Unknown plan ids and unknown entitlement keys are dropped rather than
 * carried through, so a newer writer using a key this code version has never
 * heard of can never accidentally deny a feature.
 *
 * ## Why this takes the time
 *
 * A trial lends a plan until an instant, so *which plan a workspace is on* is
 * a question about now. Answering it here, on every read, is what lets a trial
 * end with no job, no sweep and no lag: the stored row already describes the
 * world after the trial, and this function stops preferring the trial the
 * moment it is over. The cost is a comparison of two numbers on a value the
 * caller had already loaded, and none of it is reached at all when cloud is
 * off.
 *
 * `now` is a parameter rather than a call to the clock so both sides of that
 * instant are reachable in a test. A test that reads the real clock cannot
 * tell "the trial ended" from "there was never a trial".
 */
export function resolveCloudConfig(
  stored: StoredCloudConfig | null | undefined,
  now: Date = new Date()
): CloudConfig {
  if (!stored || typeof stored !== 'object') return DISABLED_CLOUD_CONFIG
  if (stored.enabled !== true) return DISABLED_CLOUD_CONFIG

  const storedPlan = typeof stored.plan === 'string' && isPlanId(stored.plan) ? stored.plan : null
  if (stored.plan && !storedPlan) {
    log.error({ plan: stored.plan }, 'cloud config names an unknown plan; treating as no plan')
  }

  const billing = sanitizeBilling(stored.billing)
  const trial = sanitizeTrial(stored.trial)
  const trialActive = isTrialActive(trial, billing, storedPlan, now)

  return {
    enabled: true,
    plan: trialActive && trial ? trial.plan : storedPlan,
    entitlements: sanitizeEntitlements(stored.entitlements),
    billing,
    trial,
    trialActive,
    source: stored.source === 'config' || stored.source === 'billing' ? stored.source : null,
    updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : null,
    upgradeUrl: readUpgradeUrl(stored),
  }
}

/**
 * Is the recorded trial the thing deciding this workspace's plan right now?
 *
 * Three conditions, each closing a different way a trial could do harm:
 *
 * 1. **It has not run out.** The end instant is exclusive.
 * 2. **The workspace has not bought anything.** A trial is what a workspace
 *    holds *before* there is a billing relationship; once a subscription
 *    exists, the subscription decides and a leftover trial record must not
 *    quietly grant more than was paid for.
 * 3. **It would add rather than subtract.** A trial that ranks below the
 *    stored plan is ignored outright, so an operator who pinned a workspace to
 *    Scale cannot have it dropped to a Pro trial for a fortnight by a record
 *    written before the pin.
 */
function isTrialActive(
  trial: CloudTrial | null,
  billing: CloudBilling,
  storedPlan: PlanId | null,
  now: Date
): boolean {
  if (!trial) return false
  if (billing.subscriptionRef) return false
  if (now.getTime() >= Date.parse(trial.endsAt)) return false
  const storedRank = storedPlan ? PLAN_CATALOGUE[storedPlan].rank : -1
  return PLAN_CATALOGUE[trial.plan].rank > storedRank
}

/**
 * A stored trial is only a trial if every part of it is intelligible.
 *
 * A half-written record — an unknown plan, a date nothing can parse — must
 * resolve to *no trial* rather than to a trial that never ends or one on a
 * plan this version cannot rank. Both of those would be a workspace holding
 * features nobody granted it, indefinitely.
 */
function sanitizeTrial(raw: StoredCloudConfig['trial']): CloudTrial | null {
  if (!raw || typeof raw !== 'object') return null
  const plan = typeof raw.plan === 'string' && isPlanId(raw.plan) ? raw.plan : null
  const startedAt = str(raw.startedAt)
  const endsAt = str(raw.endsAt)
  if (!plan || !startedAt || !endsAt) return null
  if (Number.isNaN(Date.parse(startedAt)) || Number.isNaN(Date.parse(endsAt))) {
    log.error({ startedAt, endsAt }, 'cloud config holds an unparseable trial window; ignoring it')
    return null
  }
  return { plan, startedAt, endsAt }
}

function sanitizeEntitlements(
  raw: Record<string, boolean> | undefined
): Partial<Record<EntitlementKey, boolean>> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Partial<Record<EntitlementKey, boolean>> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'boolean') continue
    if (!isEntitlementKey(key)) continue
    out[key] = value
  }
  return out
}

function sanitizeBilling(raw: StoredCloudConfig['billing']): CloudBilling {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_BILLING }
  const status =
    typeof raw.status === 'string' && (BILLING_STATUSES as readonly string[]).includes(raw.status)
      ? (raw.status as BillingStatus)
      : null
  return {
    provider: str(raw.provider),
    customerRef: str(raw.customerRef),
    subscriptionRef: str(raw.subscriptionRef),
    status,
    currentPeriodEnd: str(raw.currentPeriodEnd),
  }
}

function readUpgradeUrl(stored: StoredCloudConfig): string | null {
  const value = (stored as { upgradeUrl?: unknown }).upgradeUrl
  return typeof value === 'string' && value.length > 0 ? value : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * The active cloud config for this workspace.
 *
 * Reads through the existing Redis-backed workspace-settings blob rather than
 * adding a second process-level cache. That is a deliberate choice: every
 * settings mutation already calls `invalidateSettingsCache()`, so this needs
 * no invalidation seam of its own, and it adds no new module-scope mutable
 * state to a codebase that is actively trying to shed it
 * (SAAS-HOSTING-STACK.md §4.4).
 *
 * A failed settings read resolves to the *disabled* config rather than
 * throwing. On a self-hosted install that is simply today's behaviour
 * preserved through an outage; on a cloud workspace it means a broken settings
 * read grants rather than denies. That is the right direction for a
 * commercial gate — an entitlement is not an authorization boundary, and
 * under a settings-read failure every gated feature is broken anyway — but it
 * is a real, deliberate fail-open and is called out in CLOUD-CONFIG.md.
 */
export async function getCloudConfig(): Promise<CloudConfig> {
  try {
    // Dynamic import: settings.service is a large module that imports this
    // domain's helpers, so a static import here risks a load-time cycle. Same
    // reasoning as requireSettingsCached() in settings.helpers.ts.
    const { getWorkspaceSettings } = await import('../settings.service')
    const workspace = await getWorkspaceSettings()
    const stored = (workspace?.settings as { cloud?: StoredCloudConfig | null } | undefined)?.cloud
    return resolveCloudConfig(stored ?? null)
  } catch (error) {
    log.error({ err: error }, 'cloud config read failed; falling back to disabled')
    return DISABLED_CLOUD_CONFIG
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export interface CloudWriteResult {
  /** False when the merge produced a block equivalent to the stored one. */
  changed: boolean
  /** `settings.cloud_revision` after this call. */
  revision: number
}

/**
 * The single mutation seam for `settings.cloud`.
 *
 * ## Two writers, one lock
 *
 * The declarative config file's reconciler and the billing module both write
 * this column, and both are read-modify-write over a whole JSON block. The
 * naive shape — read the row, merge in memory, write it back — loses updates:
 * the reconciler reads at T0, billing writes `billing.subscriptionRef` at T1,
 * the reconciler writes its stale merge at T2, and the subscription reference
 * is gone with nothing recording that it ever existed.
 *
 * The read, the merge and the write therefore all happen inside one
 * transaction that holds `SELECT … FOR UPDATE` on the settings row. Because
 * `settings` is exactly one row per database, that lock serialises every
 * writer of this column: the second writer's merge is computed against the
 * first writer's committed value, so both survive. `cloud_revision` is bumped
 * on every effective write, which makes an interleave visible after the fact
 * and gives a caller that read in an earlier request a token to pass back.
 *
 * `expectedRevision` is for that second case — a UI that rendered a plan and
 * then submitted a change. Server-side writers (the reconciler, a webhook)
 * omit it: they have nothing stale to protect, because the merge they want is
 * computed under the lock from whatever is current.
 *
 * ## Managed paths
 *
 * A writer other than `config` is refused any path the config file has claimed
 * in `settings.managed_field_paths` — so if an operator pins `cloud.plan` in
 * `/etc/quackback/config.yaml`, the billing module cannot quietly move the
 * workspace to a different plan on the next webhook. The file wins where it
 * declares; the other writer owns everything it does not. That check also
 * reads the locked row, so it cannot be raced by a reconcile that claims a
 * path between the check and the write.
 */
export async function writeCloudConfig(
  patch: CloudConfigPatch,
  opts: { writer: CloudWriter; now?: Date; expectedRevision?: number }
): Promise<CloudWriteResult> {
  const paths = cloudPatchPaths(patch)
  if (paths.length === 0) return { changed: false, revision: -1 }
  validatePatch(patch)

  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: settings.id,
        cloud: settings.cloud,
        cloudRevision: settings.cloudRevision,
        managedFieldPaths: settings.managedFieldPaths,
      })
      .from(settings)
      .limit(1)
      .for('update')

    if (!row) throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')

    if (opts.expectedRevision !== undefined && row.cloudRevision !== opts.expectedRevision) {
      throw new ConflictError(
        'CLOUD_REVISION_CONFLICT',
        'Plan and billing settings changed in another session. Reload and try again.'
      )
    }

    if (opts.writer !== 'config') {
      const managed = (row.managedFieldPaths as string[] | null) ?? []
      for (const path of paths) {
        if (isPathManaged(path, managed)) {
          throw new ForbiddenError(
            'FIELD_MANAGED',
            `Field "${path}" is managed by the declarative config file; the ${opts.writer} writer cannot change it.`
          )
        }
      }
    }

    const current = row.cloud as StoredCloudConfig | null
    const merged = mergeCloudConfig(current, patch, opts)
    // Idempotent by design: the reconciler polls every 30s and a provider
    // redelivers webhooks, so a write that changes nothing substantive must
    // not bump the revision, bust the settings cache, or churn the row.
    // `cloudConfigEquivalent` ignores the `source`/`updatedAt` stamp, which
    // otherwise differs on every single call.
    if (cloudConfigEquivalent(merged, current)) {
      return { changed: false, revision: row.cloudRevision, plan: merged.plan }
    }

    const revision = row.cloudRevision + 1
    await tx
      .update(settings)
      .set({ cloud: merged, cloudRevision: revision })
      .where(eq(settings.id, row.id))
    // Same bump every other settings write performs, so a pod's cached
    // auth instance is rebuilt against the new row rather than serving a
    // stale one. Guarded by the equivalence check above, so a no-op
    // reconcile tick does not invalidate every pod's auth every 30s.
    await bumpAuthConfigVersionInTx(tx)
    return { changed: true, revision, plan: merged.plan }
  })

  if (result.changed) {
    await invalidateSettingsCache()
    log.info(
      { writer: opts.writer, paths, plan: result.plan, revision: result.revision },
      'cloud config written'
    )
  }
  return { changed: result.changed, revision: result.revision }
}

/** Current `settings.cloud_revision`, for a caller that will write later. */
export async function getCloudRevision(): Promise<number> {
  const [row] = await db.select({ revision: settings.cloudRevision }).from(settings).limit(1)
  return row?.revision ?? 0
}

function validatePatch(patch: CloudConfigPatch): void {
  if (patch.plan !== undefined && patch.plan !== null && !isPlanId(patch.plan)) {
    throw new ValidationError('CLOUD_UNKNOWN_PLAN', `Unknown plan "${patch.plan}"`)
  }
  if (patch.trial && !isPlanId(patch.trial.plan)) {
    // A trial on a plan nothing can rank is read as no trial at all, so
    // storing one would be a workspace whose trial silently never happened.
    throw new ValidationError('CLOUD_UNKNOWN_PLAN', `Unknown trial plan "${patch.trial.plan}"`)
  }
  for (const key of Object.keys(patch.entitlements ?? {})) {
    if (!isEntitlementKey(key)) {
      throw new ValidationError('CLOUD_UNKNOWN_ENTITLEMENT', `Unknown entitlement "${key}"`)
    }
  }
}
