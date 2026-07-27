/**
 * Field-level audit diff for identity-provider upserts.
 *
 * The `idp.updated` event used to record a hand-written `{ label, enabled }`
 * pair, leaving every field that actually decides identity resolution —
 * `clientId`, the endpoints, `scopes`, `attributeMapping`, `autoProvisionRole`
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
  'attributeMapping',
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
      if (next[field] !== undefined) after[field] = next[field] as JsonValue
    }
    return { before: null, after }
  }

  const before: Record<string, JsonValue> = {}
  const after: Record<string, JsonValue> = {}
  for (const field of AUDITED_FIELDS) {
    const proposed = next[field]
    if (proposed === undefined) continue
    if (sameValue(prior[field], proposed)) continue
    before[field] = (prior[field] ?? null) as JsonValue
    after[field] = proposed as JsonValue
  }
  return { before, after }
}
