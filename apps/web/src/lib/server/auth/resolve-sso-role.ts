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
 * scalars are compared via case-insensitive equality. Returns null when
 * no rule matches (or no mapping is set) so the caller can fall back to
 * the provider's default role (`autoProvisionRole`).
 */

import type { IdentityProviderAttributeMapping } from '@/lib/server/db'
import type { Role } from '@/lib/shared/roles'

type Claims = Record<string, unknown>

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
 * when no rule matches or the workspace hasn't configured attribute
 * mapping — the caller falls back to the provider's autoProvisionRole.
 */
export function resolveSsoRole(
  claims: Claims,
  mapping: IdentityProviderAttributeMapping | undefined
): Role | null {
  if (!mapping) return null
  const claim = getNestedClaim(claims, mapping.claimPath)
  for (const rule of mapping.rules) {
    if (matchesRule(claim, rule.whenContains)) {
      return rule.role
    }
  }
  // No rule matched — the caller falls back to the provider's default role.
  return null
}
