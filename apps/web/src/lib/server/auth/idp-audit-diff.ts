/**
 * Field-level audit diff for identity-provider upserts.
 *
 * The `idp.updated` event used to record a hand-written `{ label, enabled }`
 * pair, leaving every field that actually decides identity resolution —
 * `clientId`, the endpoints, `scopes`, `claimMapping`, `autoProvisionRole`
 * — with no audit trace at all.
 *
 * That is a real privilege-boundary gap, not just thin logging: someone holding
 * provider-management rights could repoint the claim used for identity, sign in
 * as a colleague, and repoint it back, and the trail would hold two
 * byte-identical rows. Diffing the whole DTO makes both saves visible.
 *
 * Pure (no DB, no request context) so the rule is unit-testable and so the
 * server function stays a thin caller.
 */

import type { JsonValue } from '@/lib/server/audit/log'
import { claimMappingFor, type ClaimRoleMapping } from '@/lib/shared/oidc-claim-mapping'

/** Every field worth an audit trace. The client secret is deliberately absent:
 *  it never travels through this DTO (it has its own credential function), so
 *  there is nothing to redact here. */
const AUDITED_FIELDS = [
  'registrationId',
  'label',
  'kind',
  'clientId',
  'discoveryUrl',
  'authorizationUrl',
  'tokenUrl',
  'userInfoUrl',
  'jwksUri',
  'issuer',
  'scopes',
  'prompt',
  'tokenEndpointAuthMethod',
  'enabled',
  'autoCreateUsers',
  'autoProvisionRole',
  'claimMapping',
  'showButton',
] as const

type AuditedField = (typeof AUDITED_FIELDS)[number]

type ProviderSnapshot = Partial<Record<AuditedField, unknown>>

/** Structural comparison so an object-valued field (the attribute mapping)
 *  compares by value rather than by reference. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return false
  if (typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return false
}

function roleValuesChanged(left: ClaimRoleMapping, right: ClaimRoleMapping): boolean {
  const longest = Math.max(left.rules.length, right.rules.length)
  for (let i = 0; i < longest; i++) {
    if (left.rules[i]?.whenContains !== right.rules[i]?.whenContains) return true
  }
  return false
}

/**
 * Configuration-only view of claim mapping. Paths, role targets, rule indices,
 * and sync flags stay; match values, unknown subtrees, and raw snapshots do not.
 */
function projectClaimMapping(stored: unknown, comparedTo?: unknown): JsonValue | null {
  if (stored == null) return null
  const mapping = claimMappingFor(stored)
  if (Object.keys(mapping).length === 0) return {}

  const projected: Record<string, JsonValue> = {}

  if (mapping.profile) {
    const profile: Record<string, JsonValue> = {}
    if (mapping.profile.sources) profile.sources = [...mapping.profile.sources]
    if (mapping.profile.claims) profile.claims = { ...mapping.profile.claims }
    if (mapping.profile.allowMissingEmail === true) profile.allowMissingEmail = true
    projected.profile = profile
  }

  if (mapping.role) {
    const role: Record<string, JsonValue> = {
      claimPath: mapping.role.claimPath,
      ruleCount: mapping.role.rules.length,
      rules: mapping.role.rules.map((rule, index) => ({ index, role: rule.role })),
    }
    if (mapping.role.syncOnEverySignIn === true) role.syncOnEverySignIn = true
    if (comparedTo != null) {
      const other = claimMappingFor(comparedTo).role
      if (other && roleValuesChanged(mapping.role, other)) {
        role.ruleValuesChanged = true
      }
    }
    projected.role = role
  }

  if (mapping.attributes) {
    const attributes: Record<string, JsonValue> = {}
    if (mapping.attributes.map) {
      attributes.map = mapping.attributes.map.map((entry) => ({
        claimPath: entry.claimPath,
        attributeKey: entry.attributeKey,
      }))
    }
    if (mapping.attributes.overrideExisting === true) attributes.overrideExisting = true
    if (mapping.attributes.syncOnSignIn === true) attributes.syncOnSignIn = true
    projected.attributes = attributes
  }

  return projected
}

function auditedValue(field: AuditedField, value: unknown, comparedTo?: unknown): JsonValue {
  if (field === 'claimMapping') return projectClaimMapping(value, comparedTo)
  return (value ?? null) as JsonValue
}

export interface ProviderAuditDiff {
  /** Null on create; otherwise the prior value of each changed field. */
  before: Record<string, JsonValue> | null
  /** The full snapshot on create; otherwise the new value of each changed field. */
  after: Record<string, JsonValue>
}

/**
 * Diff a provider upsert against its prior row.
 *
 * Honours patch semantics: a field the caller did not supply is left untouched
 * by the service, so it is not reported as a change.
 */
export function diffProviderAudit(
  prior: ProviderSnapshot | null,
  next: ProviderSnapshot
): ProviderAuditDiff {
  if (!prior) {
    const after: Record<string, JsonValue> = {}
    for (const field of AUDITED_FIELDS) {
      if (next[field] !== undefined) after[field] = auditedValue(field, next[field])
    }
    return { before: null, after }
  }

  const before: Record<string, JsonValue> = {}
  const after: Record<string, JsonValue> = {}
  for (const field of AUDITED_FIELDS) {
    const proposed = next[field]
    if (proposed === undefined) continue
    const previous = auditedValue(field, prior[field] ?? null)
    const nextValue = auditedValue(field, proposed, prior[field] ?? null)
    if (sameValue(previous, nextValue)) continue
    before[field] = previous
    after[field] = nextValue
  }
  return { before, after }
}
