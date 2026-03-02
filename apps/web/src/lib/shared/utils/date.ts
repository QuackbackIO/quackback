/**
 * Shared date utilities
 */

/**
 * Safely convert a date value to ISO string.
 * Handles both Date objects and ISO strings (Neon HTTP driver returns strings).
 */
export function toIsoString(value: Date | string): string {
  if (typeof value === 'string') {
    return value
  }
  return value.toISOString()
}

/**
 * Safely convert an optional date value to ISO string or null.
 */
export function toIsoStringOrNull(value: Date | string | null | undefined): string | null {
  if (value == null) {
    return null
  }
  return toIsoString(value)
}
