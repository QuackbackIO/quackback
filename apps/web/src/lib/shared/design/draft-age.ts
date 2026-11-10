/** A draft untouched for longer than this is from an earlier visit, and the builder says so. */
export const STALE_DRAFT_DAYS = 14

/** When a stale draft was last changed, or null for a recent draft or none. */
export function staleDraftSince(savedAt: string | null, now: Date): Date | null {
  if (!savedAt) return null
  const at = new Date(savedAt)
  if (Number.isNaN(at.getTime())) return null
  return now.getTime() - at.getTime() > STALE_DRAFT_DAYS * 86_400_000 ? at : null
}
