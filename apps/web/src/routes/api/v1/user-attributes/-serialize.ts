/**
 * Shared serializer for user-attribute API responses (colocated helper; the `-`
 * prefix keeps it out of the generated route tree).
 */
import type { UserAttribute } from '@/lib/server/domains/user-attributes/user-attribute.types'

export function serializeUserAttribute(a: UserAttribute) {
  return {
    id: a.id,
    key: a.key,
    label: a.label,
    description: a.description,
    type: a.type,
    currencyCode: a.currencyCode,
    externalKey: a.externalKey,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  }
}
