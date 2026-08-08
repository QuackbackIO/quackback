import type { QuackbackConfigSpec } from './schema'

/**
 * Derive the managed-paths list from a parsed config spec.
 *
 * Path conventions:
 * - `workspace.name`, `workspace.slug`, `workspace.useCase` — leaf
 * - `tierLimits` — whole-block (matches every `tierLimits.*` child)
 * - `cloud.enabled`, `cloud.plan`, `cloud.entitlements`, `cloud.billing`,
 *   `cloud.upgradeUrl` — leaf, deliberately NOT a whole-block `cloud` lock.
 *   The cloud block has two writers (this file and, later, a billing module),
 *   so locking the whole subtree whenever the file mentions any part of it
 *   would stop the billing module recording a subscription reference the file
 *   never claimed. Leaf paths let each writer own exactly what it declares.
 *
 * The order matters only for snapshot-style equality in tests; runtime
 * checks via `isPathManaged` are order-insensitive.
 */
export function computeManagedPaths(spec: QuackbackConfigSpec): string[] {
  const paths: string[] = []
  if (spec.workspace?.name !== undefined) paths.push('workspace.name')
  if (spec.workspace?.slug !== undefined) paths.push('workspace.slug')
  if (spec.workspace?.useCase !== undefined) paths.push('workspace.useCase')
  if (spec.tierLimits !== undefined) paths.push('tierLimits')
  if (spec.cloud !== undefined) {
    // `enabled` is always claimed when the block is present: the file having an
    // opinion at all means the file owns the master switch.
    paths.push('cloud.enabled')
    if (spec.cloud.plan !== undefined) paths.push('cloud.plan')
    if (spec.cloud.entitlements !== undefined) paths.push('cloud.entitlements')
    if (spec.cloud.billing !== undefined) paths.push('cloud.billing')
    if (spec.cloud.upgradeUrl !== undefined) paths.push('cloud.upgradeUrl')
  }
  return paths
}

/**
 * Check whether `path` is locked by the managed list.
 *
 * A path is managed when it appears verbatim OR when one of its
 * ancestors is in the list (whole-block lock semantics).
 */
export function isPathManaged(path: string, managed: string[]): boolean {
  for (const m of managed) {
    if (path === m) return true
    if (path.startsWith(`${m}.`)) return true
  }
  return false
}
