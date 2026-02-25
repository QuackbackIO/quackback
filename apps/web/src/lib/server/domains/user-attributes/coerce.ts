/**
 * User Attribute Value Coercion
 *
 * Shared coercion logic for converting incoming values to the declared
 * attribute type. Used by both the REST API and CDP integration sync.
 */

import type { UserAttributeType } from '@/lib/server/db'

/**
 * Coerce a value to the declared attribute type.
 * Returns undefined if the value cannot be meaningfully coerced.
 */
export function coerceAttributeValue(value: unknown, type: UserAttributeType): unknown {
  if (value === null || value === undefined) return undefined
  switch (type) {
    case 'string':
      return String(value)
    case 'number':
    case 'currency': {
      const n = Number(value)
      return isNaN(n) ? undefined : n
    }
    case 'boolean':
      if (typeof value === 'boolean') return value
      if (value === 'true' || value === '1') return true
      if (value === 'false' || value === '0') return false
      return undefined
    case 'date':
      if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value)
        return isNaN(d.getTime()) ? undefined : d.toISOString()
      }
      return undefined
    default:
      return undefined
  }
}
