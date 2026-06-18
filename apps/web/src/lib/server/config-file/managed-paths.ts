import type { QuackbackConfigSpec } from './schema'

/**
 * Derive the managed-paths list from a parsed config spec.
 *
 * Path conventions:
 * - `workspace.name`, `workspace.slug`, `workspace.useCase` — leaf
 * - `tierLimits` — whole-block (matches every `tierLimits.*` child)
 * - `features.<key>` — per-key (only the listed keys lock; others
 *   stay UI-editable)
 * - `auth.oauth.<providerId>` — per-key (each OAuth provider locks
 *   independently; openSignup stays UI-editable unless declared)
 * - `auth.openSignup` — leaf
 * - `auth.ssoOidc.<key>` — per-key (each ssoOidc field locks
 *   independently; clientSecret never appears here because the file
 *   never holds secrets)
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
  if (spec.features) {
    for (const key of Object.keys(spec.features)) {
      paths.push(`features.${key}`)
    }
  }
  if (spec.auth) {
    if (spec.auth.oauth) {
      for (const key of Object.keys(spec.auth.oauth)) {
        paths.push(`auth.oauth.${key}`)
      }
    }
    if (spec.auth.openSignup !== undefined) paths.push('auth.openSignup')
    if (spec.auth.ssoOidc) {
      for (const key of Object.keys(spec.auth.ssoOidc)) {
        paths.push(`auth.ssoOidc.${key}`)
      }
    }
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
