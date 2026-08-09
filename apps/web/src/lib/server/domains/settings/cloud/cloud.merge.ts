/**
 * Pure merge + managed-path helpers for `settings.cloud`.
 *
 * Deliberately free of any database import so the config-file reconciler —
 * which is db-agnostic by design, with its dependencies injected — can use the
 * same merge the runtime writer uses. One merge rule, two writers, no drift.
 */

import type { StoredCloudConfig } from '@/lib/shared/db-types'
import type { CloudBilling, CloudWriter, EntitlementKey, PlanId } from './cloud.types'

export interface CloudConfigPatch {
  enabled?: boolean
  plan?: PlanId | null
  /** Sparse. Merged key-by-key into the stored overrides. */
  entitlements?: Partial<Record<EntitlementKey, boolean>>
  /** Sparse. Merged field-by-field into the stored billing block. */
  billing?: Partial<CloudBilling>
  upgradeUrl?: string | null
}

/**
 * Dot-paths this block owns, in `settings.managed_field_paths` terms. Leaf
 * paths, not a whole-block `cloud` lock — see managed-paths.ts for why.
 */
export const CLOUD_MANAGED_PATHS = {
  enabled: 'cloud.enabled',
  plan: 'cloud.plan',
  entitlements: 'cloud.entitlements',
  billing: 'cloud.billing',
  upgradeUrl: 'cloud.upgradeUrl',
} as const satisfies Record<keyof CloudConfigPatch, string>

/** Which managed paths a patch would touch. */
export function cloudPatchPaths(patch: CloudConfigPatch): string[] {
  return (Object.keys(CLOUD_MANAGED_PATHS) as Array<keyof CloudConfigPatch>)
    .filter((key) => patch[key] !== undefined)
    .map((key) => CLOUD_MANAGED_PATHS[key])
}

/**
 * Merge a patch into a stored block.
 *
 * Sub-blocks merge rather than replace. This is what lets a billing module and
 * the config reconciler share one column: a billing write that only sets
 * `billing.subscriptionRef` leaves a config-written `plan` untouched, and a
 * config reconcile that only declares `plan` leaves the billing refs intact.
 *
 * `source` and `updatedAt` are stamped on every write so a support question of
 * the form "why did this workspace lose that feature" has an answer in the row
 * itself.
 */
export function mergeCloudConfig(
  current: StoredCloudConfig | null | undefined,
  patch: CloudConfigPatch,
  opts: { writer: CloudWriter; now?: Date }
): StoredCloudConfig {
  const base = current && typeof current === 'object' ? current : null
  const next: StoredCloudConfig = {
    enabled: patch.enabled ?? base?.enabled ?? false,
    plan: patch.plan !== undefined ? patch.plan : (base?.plan ?? null),
    entitlements: { ...(base?.entitlements ?? {}), ...(patch.entitlements ?? {}) },
    billing: { ...(base?.billing ?? {}), ...(patch.billing ?? {}) },
    source: opts.writer,
    updatedAt: (opts.now ?? new Date()).toISOString(),
  }
  const upgradeUrl =
    patch.upgradeUrl !== undefined
      ? patch.upgradeUrl
      : ((base as { upgradeUrl?: string | null } | null)?.upgradeUrl ?? null)
  if (upgradeUrl) (next as { upgradeUrl?: string | null }).upgradeUrl = upgradeUrl
  return next
}

/**
 * Compare two stored blocks ignoring the write stamp, so a reconcile that
 * changes nothing substantive is still a no-op. Without this, `updatedAt`
 * would differ on every tick and the reconciler's idempotence check — the
 * thing that keeps a 30-second poll from writing to the database forever —
 * would never fire.
 */
export function cloudConfigEquivalent(
  a: StoredCloudConfig | null | undefined,
  b: StoredCloudConfig | null | undefined
): boolean {
  return stableKey(a) === stableKey(b)
}

function stableKey(value: StoredCloudConfig | null | undefined): string {
  if (!value) return 'null'
  const { source: _source, updatedAt: _updatedAt, ...rest } = value
  return stableStringify(rest)
}

/**
 * JSON with object keys sorted at every depth. `JSON.stringify`'s array
 * replacer is not a substitute: it filters keys at *all* levels, so passing
 * the top-level key list would silently erase everything inside `billing` and
 * `entitlements` and make two different blocks compare equal.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
  return `{${entries.join(',')}}`
}
