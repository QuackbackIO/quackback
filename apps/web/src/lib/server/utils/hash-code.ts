/**
 * Simple Java-style string hash code for use as pg_advisory_xact_lock keys.
 */
export function hashCode(s: string): number {
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    hash = (Math.imul(31, hash) + s.charCodeAt(i)) | 0
  }
  return hash
}
