/**
 * IdP-claim-driven role resolution. Pure: one claims bag + a role mapping
 * in, a role (or null) out. Shared by production sign-in and the editor's
 * outcome preview.
 *
 * resolveSsoRole matches the resolved claim value against the mapping's
 * rules (first-match-wins). Arrays are scanned member-wise; scalars are
 * compared via case-insensitive equality. Returns null when no rule matches
 * (or no mapping is set) so the caller can fall back to the provider's
 * default role. A match carries the rule's `roleId` when it grants a
 * workspace role on top of the member tier.
 */

import { getClaimByPath, type ClaimRoleMapping } from './oidc-claim-mapping'
import type { Role } from './roles'

type Claims = Record<string, unknown>

/** Whether one rule's value is in a resolved claim. */
export function roleRuleMatchesClaim(claim: unknown, whenContains: string): boolean {
  const needle = whenContains.toLowerCase()
  if (Array.isArray(claim)) {
    return claim.some((entry) => typeof entry === 'string' && entry.toLowerCase() === needle)
  }
  if (typeof claim === 'string') {
    return claim.toLowerCase() === needle
  }
  return false
}

/** The first matching rule: its tier, the workspace role it grants, if any, and where it sits. */
export type SsoRoleMatch = { role: Role; roleId?: string; ruleIndex: number }

export function resolveSsoRoleMatch(
  claims: Claims,
  mapping: ClaimRoleMapping | undefined
): SsoRoleMatch | null {
  if (!mapping) return null
  const claim = getClaimByPath(claims, mapping.claimPath)
  for (let i = 0; i < mapping.rules.length; i++) {
    const rule = mapping.rules[i]
    if (rule && roleRuleMatchesClaim(claim, rule.whenContains)) {
      return rule.roleId
        ? { role: rule.role, roleId: rule.roleId, ruleIndex: i }
        : { role: rule.role, ruleIndex: i }
    }
  }
  return null
}

export function resolveSsoRole(claims: Claims, mapping: ClaimRoleMapping | undefined): Role | null {
  return resolveSsoRoleMatch(claims, mapping)?.role ?? null
}
