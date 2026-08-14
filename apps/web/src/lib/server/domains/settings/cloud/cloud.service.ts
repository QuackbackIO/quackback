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
  DISABLED_CLOUD_CONFIG,
  isEntitlementKey,
  isPlanId,
  type CloudConfig,
  type CloudWriter,
} from './cloud.types'
import { parseBillingProjection } from './billing-projection'

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

  const projection = parseBillingProjection(stored.projection)
  if (!projection) {
    log.error('cloud config has no valid control-plane projection; keeping commercial mode off')
    return DISABLED_CLOUD_CONFIG
  }
  const expiresAt = projection.planLimitsExpireAt
  const projectedAccessExpired = expiresAt !== null && now.getTime() >= Date.parse(expiresAt)
  const plan = projectedAccessExpired ? 'free' : projection.effectivePlan
  const trial =
    projection.trialStartedAt && projection.trialExpiresAt
      ? {
          plan: 'pro' as const,
          startedAt: projection.trialStartedAt,
          endsAt: projection.trialExpiresAt,
        }
      : null
  const trialActive = Boolean(trial && now.getTime() < Date.parse(trial.endsAt))

  return {
    enabled: true,
    plan,
    entitlements: projectedAccessExpired ? {} : projection.entitlements,
    billing: {
      provider: null,
      customerRef: null,
      subscriptionRef: null,
      status: projection.subscriptionStatus,
      currentPeriodEnd: projection.renewalAt,
    },
    trial,
    trialActive,
    canUpgrade: projection.canUpgrade,
    canManageBilling: projection.canManageBilling,
    renewalAt: projection.renewalAt,
    cancellationAt: projection.cancellationAt,
    source: null,
    updatedAt: null,
    upgradeUrl: '/admin/settings/billing',
  }
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
