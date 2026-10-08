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

import { getClaimByPath, readRoleRule, roleMappingFor } from './oidc-claim-mapping'
import { isPlainRecord as isRecord } from './record'
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

/**
 * The first rule the claims match. `role` is a role section as stored or
 * drafted (or an already-read `ClaimRoleMapping`). Rules the reader cannot
 * read are skipped, but `ruleIndex` is the rule's position in the section as
 * given, so it names the same row the editor and the per-rule preview show.
 */
export function resolveSsoRoleMatch(claims: Claims, role: unknown): SsoRoleMatch | null {
  const mapping = roleMappingFor({ role })
  if (!mapping || !isRecord(role) || !Array.isArray(role.rules)) return null
  const claim = getClaimByPath(claims, mapping.claimPath)
  for (let i = 0; i < role.rules.length; i++) {
    const rule = readRoleRule(role.rules[i])
    if (rule && roleRuleMatchesClaim(claim, rule.whenContains)) {
      return rule.roleId
        ? { role: rule.role, roleId: rule.roleId, ruleIndex: i }
        : { role: rule.role, ruleIndex: i }
    }
  }
  return null
}

export function resolveSsoRole(claims: Claims, mapping: unknown): Role | null {
  return resolveSsoRoleMatch(claims, mapping)?.role ?? null
}
