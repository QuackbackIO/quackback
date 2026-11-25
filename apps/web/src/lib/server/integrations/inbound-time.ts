/**
 * Revision times for inbound status updates. Each returns an ISO 8601 UTC string,
 * or undefined when the value is missing or invalid, so a bad timestamp leads to
 * review instead of a thrown error that would retry the receipt forever.
 */

/** An ISO 8601 time. Offsets written without a colon (`+0000`) are accepted. */
export function isoTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  const ms = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined
}

/** Epoch milliseconds, as a number or a numeric string. */
export function isoFromMillis(value: unknown): string | undefined {
  const millis = typeof value === 'string' && value.trim() ? Number(value) : value
  if (typeof millis !== 'number' || millis <= 0) return undefined
  const date = new Date(millis)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}
