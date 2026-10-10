/**
 * Shared plain-record guard for claim-mapping JSON handling.
 */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
