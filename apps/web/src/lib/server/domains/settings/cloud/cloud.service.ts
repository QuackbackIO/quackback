import type { StoredCloudConfig } from '@/lib/shared/db-types'
import { db, eq, settings } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { ForbiddenError, ValidationError } from '@/lib/shared/errors'
import { isPathManaged } from '@/lib/server/config-file/managed-paths'
import { invalidateSettingsCache, requireSettings } from '../settings.helpers'
import { cloudPatchPaths, mergeCloudConfig, type CloudConfigPatch } from './cloud.merge'
import {
  BILLING_STATUSES,
  DISABLED_CLOUD_CONFIG,
  EMPTY_BILLING,
  isEntitlementKey,
  isPlanId,
  type BillingStatus,
  type CloudBilling,
  type CloudConfig,
  type CloudWriter,
  type EntitlementKey,
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
 * carried through, so a newer control plane writing a key this code version
 * has never heard of can never accidentally deny a feature.
 */
export function resolveCloudConfig(stored: StoredCloudConfig | null | undefined): CloudConfig {
  if (!stored || typeof stored !== 'object') return DISABLED_CLOUD_CONFIG
  if (stored.enabled !== true) return DISABLED_CLOUD_CONFIG

  const plan = typeof stored.plan === 'string' && isPlanId(stored.plan) ? stored.plan : null
  if (stored.plan && !plan) {
    log.error({ plan: stored.plan }, 'cloud config names an unknown plan; treating as no plan')
  }

  return {
    enabled: true,
    plan,
    entitlements: sanitizeEntitlements(stored.entitlements),
    billing: sanitizeBilling(stored.billing),
    source: stored.source === 'config' || stored.source === 'billing' ? stored.source : null,
    updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : null,
    upgradeUrl: readUpgradeUrl(stored),
  }
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
 * Reads through the existing Redis-backed tenant-settings blob rather than
 * adding a second process-level cache. That is a deliberate choice: every
 * settings mutation already calls `invalidateSettingsCache()`, so this needs
 * no invalidation seam of its own, and it adds no new module-scope mutable
 * state to a codebase that is actively trying to shed it
 * (SAAS-HOSTING-STACK.md §4.4).
 *
 * A failed settings read resolves to the *disabled* config rather than
 * throwing. On a self-hosted install that is simply today's behaviour
 * preserved through an outage; on a cloud tenant it means a broken settings
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
    const { getTenantSettings } = await import('../settings.service')
    const tenant = await getTenantSettings()
    const stored = (tenant?.settings as { cloud?: StoredCloudConfig | null } | undefined)?.cloud
    return resolveCloudConfig(stored ?? null)
  } catch (error) {
    log.error({ err: error }, 'cloud config read failed; falling back to disabled')
    return DISABLED_CLOUD_CONFIG
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * The single mutation seam for `settings.cloud`.
 *
 * Both writers go through here. A writer other than `config` is refused any
 * path the declarative config file has claimed in `settings.managed_field_paths`
 * — so if an operator pins `cloud.plan` in `/etc/quackback/config.yaml`, the
 * billing module cannot quietly move the workspace to a different plan on the
 * next webhook. The file wins where it declares; the other writer owns
 * everything it does not.
 */
export async function writeCloudConfig(
  patch: CloudConfigPatch,
  opts: { writer: CloudWriter; now?: Date }
): Promise<void> {
  const paths = cloudPatchPaths(patch)
  if (paths.length === 0) return
  validatePatch(patch)

  const row = await requireSettings()
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

  const merged = mergeCloudConfig(row.cloud as StoredCloudConfig | null, patch, opts)
  await db.update(settings).set({ cloud: merged }).where(eq(settings.id, row.id))
  await invalidateSettingsCache()
  log.info({ writer: opts.writer, paths, plan: merged.plan }, 'cloud config written')
}

function validatePatch(patch: CloudConfigPatch): void {
  if (patch.plan !== undefined && patch.plan !== null && !isPlanId(patch.plan)) {
    throw new ValidationError('CLOUD_UNKNOWN_PLAN', `Unknown plan "${patch.plan}"`)
  }
  for (const key of Object.keys(patch.entitlements ?? {})) {
    if (!isEntitlementKey(key)) {
      throw new ValidationError('CLOUD_UNKNOWN_ENTITLEMENT', `Unknown entitlement "${key}"`)
    }
  }
}
