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
 * - `auth.identityProviders.<encodedLabel>.<field>` — per-field, scoped
 *   to a provider keyed by its label (the config carries no id). The
 *   label segment is `providerPathKey`-encoded so a dotted label can't
 *   split into extra path segments (see `providerPathKey`).
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
    if (spec.auth.identityProviders) {
      for (const provider of spec.auth.identityProviders) {
        const base = `auth.identityProviders.${providerPathKey(provider.label)}`
        // Lock every field the entry declares. `label` itself is the key,
        // not an editable field, so it isn't emitted. `domains` locks as a
        // whole block (matches every `…domains.*` child).
        paths.push(`${base}.discoveryUrl`, `${base}.clientId`)
        if (provider.enabled !== undefined) paths.push(`${base}.enabled`)
        if (provider.autoCreateUsers !== undefined) paths.push(`${base}.autoCreateUsers`)
        if (provider.autoProvisionRole !== undefined) paths.push(`${base}.autoProvisionRole`)
        if (provider.scopes !== undefined) paths.push(`${base}.scopes`)
        if (provider.domains !== undefined) paths.push(`${base}.domains`)
      }
    }
  }
  return paths
}

/**
 * Encode a provider label into a single, dot-free managed-path segment.
 *
 * Managed paths are dot-delimited and `isPathManaged` does prefix
 * (`startsWith(`${m}.`)`) matching, so a raw dot inside a label would
 * split it into multiple segments — letting an unrelated provider's lock
 * (e.g. label `"Acme"`) falsely capture another's fields (label
 * `"Acme.io"`). `encodeURIComponent` leaves `.` untouched, so dots are
 * explicitly percent-encoded afterwards. The result is injective (no two
 * distinct labels collide), reversible, and guaranteed dot-free.
 */
export function providerPathKey(label: string): string {
  return encodeURIComponent(label).replace(/\./g, '%2E')
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
