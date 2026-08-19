/**
 * Plan claim → user-attribute writes. Pure: claims + mapping + existing
 * values + definitions in, writes and removals out. Shared by production
 * sign-in and the editor's outcome preview.
 */

import { coerceAttributeValue } from './coerce-attribute-value'
import { getClaimByPath, claimMappingFor } from './oidc-claim-mapping'
import type { UserAttributeType } from './db-types'

export interface AttributeDefinition {
  key: string
  type: UserAttributeType
}

export type AttributeSkipReason = 'missing_claim' | 'type_mismatch' | 'kept_existing'

export interface AttributeWriteSkip {
  key: string
  reason: AttributeSkipReason
}

export function planClaimAttributeWrites({
  claims,
  mapping,
  existing,
  definitions,
  explain,
}: {
  claims: Record<string, unknown>
  mapping: NonNullable<ReturnType<typeof claimMappingFor>['attributes']>
  existing: Record<string, unknown>
  definitions: AttributeDefinition[]
  explain?: boolean
}): { valid: Record<string, unknown>; removals: string[]; skips?: AttributeWriteSkip[] } {
  const defs = new Map(definitions.map((d) => [d.key, d]))
  const valid: Record<string, unknown> = {}
  const removals: string[] = []
  const skips: AttributeWriteSkip[] = []
  const override = mapping.overrideExisting === true
  const sync = mapping.syncOnSignIn === true

  for (const entry of mapping.map ?? []) {
    const def = defs.get(entry.attributeKey)
    if (!def) continue
    const raw = getClaimByPath(claims, entry.claimPath)
    const missing = raw === undefined || raw === null || raw === ''
    if (missing) {
      if (sync && Object.prototype.hasOwnProperty.call(existing, entry.attributeKey)) {
        removals.push(entry.attributeKey)
      } else if (explain) {
        skips.push({ key: entry.attributeKey, reason: 'missing_claim' })
      }
      continue
    }
    const coerced = coerceAttributeValue(raw, def.type)
    if (coerced === undefined) {
      if (explain) skips.push({ key: entry.attributeKey, reason: 'type_mismatch' })
      continue
    }
    const hasExisting =
      existing[entry.attributeKey] !== undefined && existing[entry.attributeKey] !== null
    if (hasExisting && !override) {
      if (explain) skips.push({ key: entry.attributeKey, reason: 'kept_existing' })
      continue
    }
    valid[entry.attributeKey] = coerced
  }

  return explain ? { valid, removals, skips } : { valid, removals }
}
