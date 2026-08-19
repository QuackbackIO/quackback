/**
 * IdP-claim-driven role resolution. Pure: one claims bag + a role mapping
 * in, a role (or null) out. Shared by production sign-in and the editor's
 * outcome preview.
 *
 * resolveSsoRole matches the resolved claim value against the mapping's
 * rules (first-match-wins). Arrays are scanned member-wise; scalars are
 * compared via case-insensitive equality. Returns null when no rule matches
 * (or no mapping is set) so the caller can fall back to the provider's
 * default role.
 */

import { getClaimByPath, type ClaimRoleMapping } from './oidc-claim-mapping'
import type { Role } from './roles'

type Claims = Record<string, unknown>

/**
 * Resolve a claim by dotted path OR by literal URL-shaped key.
 * Kept as a named export so existing tests that import getNestedClaim
 * continue to pass through the server shim.
 */
export function getNestedClaim(claims: Claims, path: string): unknown {
  return getClaimByPath(claims, path)
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

export function resolveSsoRoleMatch(
  claims: Claims,
  mapping: ClaimRoleMapping | undefined
): { role: Role; ruleIndex: number } | null {
  if (!mapping) return null
  const claim = getNestedClaim(claims, mapping.claimPath)
  for (let i = 0; i < mapping.rules.length; i++) {
    const rule = mapping.rules[i]
    if (rule && matchesRule(claim, rule.whenContains)) {
      return { role: rule.role, ruleIndex: i }
    }
  }
  return null
}

export function resolveSsoRole(claims: Claims, mapping: ClaimRoleMapping | undefined): Role | null {
  return resolveSsoRoleMatch(claims, mapping)?.role ?? null
}
