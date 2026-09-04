/**
 * Shared coercion for converting incoming values to a declared user-attribute
 * type. Used by the REST API, CDP sync, claim-to-attribute writes, and the
 * editor's outcome preview.
 */

import type { UserAttributeType } from '@/lib/shared/db-types'

/**
 * Coerce a value to the declared attribute type.
 * Returns undefined if the value cannot be meaningfully coerced.
 */
export function coerceAttributeValue(value: unknown, type: UserAttributeType): unknown {
  if (value === null || value === undefined) return undefined
  switch (type) {
    case 'string':
      // Join arrays to text (`String(['a','b'])` → `a,b`). An array of
      // objects would stringify as `[object Object]`; refuse that.
      if (Array.isArray(value) && value.some((v) => v !== null && typeof v === 'object')) {
        return undefined
      }
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
