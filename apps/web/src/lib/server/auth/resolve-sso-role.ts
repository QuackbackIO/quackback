/**
 * IdP-attribute-driven role resolution.
 *
 * getNestedClaim pulls a value out of an ID-token claims object. The
 * path can be:
 *  - a dotted path on the JSON object (`realm_access.roles`)
 *  - a URL-shaped namespaced claim (`https://acme.com/roles`) — used
 *    as a single key, NOT split on slashes
 *
 * resolveSsoRole matches the resolved claim value against the
 * mapping's rules (first-match-wins). Arrays are scanned member-wise;
 * scalars are compared via case-insensitive equality. When no rule
 * matches we fall back to `defaultRole`. When no mapping is set
 * (or the mapping is undefined), returns `null` so the caller can
 * decide whether to fall back to the legacy `autoProvisionRole`.
 */

import type { AuthConfig } from '@/lib/server/domains/settings/settings.types'

type Claims = Record<string, unknown>
type AttributeMapping = NonNullable<NonNullable<AuthConfig['ssoOidc']>['attributeMapping']>
type Role = 'admin' | 'member' | 'user'

/** Resolve a claim by dotted path OR by literal URL-shaped key. */
export function getNestedClaim(claims: Claims, path: string): unknown {
  // URL-shaped paths (containing `://`) are used as a single key on the
  // top-level claims object — splitting on dots would mangle hostnames.
  if (path.includes('://')) return claims[path]

  const segments = path.split('.')
  let current: unknown = claims
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function matchesRule(claim: unknown, whenContains: string): boolean {
  const needle = whenContains.toLowerCase()
  if (Array.isArray(claim)) {
    return claim.some((entry) => typeof entry === 'string' && entry.toLowerCase() === needle)
  }
  if (typeof claim === 'string') {
    return claim.toLowerCase() === needle
  }
  return false
}

/**
 * Look up the user's role from their ID-token claims. Returns null
 * when the workspace hasn't configured attribute mapping — caller
 * falls back to the legacy autoProvisionRole field in that case.
 */
export function resolveSsoRole(claims: Claims, mapping: AttributeMapping | undefined): Role | null {
  if (!mapping) return null
  const claim = getNestedClaim(claims, mapping.claimPath)
  for (const rule of mapping.rules) {
    if (matchesRule(claim, rule.whenContains)) {
      return rule.role
    }
  }
  return mapping.defaultRole
}
