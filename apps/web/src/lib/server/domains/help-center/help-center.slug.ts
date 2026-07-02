/**
 * Build a unique, non-empty slug for a help-center entity.
 *
 * Falls back to `fallback` when the desired slug is empty — a name that
 * romanizes to nothing, e.g. emoji- or punctuation-only (slugify() already
 * transliterates CJK). An empty slug breaks the NOT NULL unique slug index
 * and slug routing (#285). Then appends a numeric suffix until `findConflict`
 * reports the candidate free. `excludeId` skips the row being renamed so a
 * slug never collides with itself.
 *
 * Collisions are probed via the caller's `findConflict` across all rows,
 * since the kb slug unique indexes are not filtered on deleted_at.
 */
export async function uniqueHelpCenterSlug(
  desired: string,
  fallback: string,
  findConflict: (candidate: string) => Promise<{ id: string } | undefined>,
  excludeId?: string
): Promise<string> {
  const base = desired || fallback
  let candidate = base
  let counter = 2
  while (true) {
    const conflict = await findConflict(candidate)
    const isSelfCollision = excludeId !== undefined && conflict?.id === excludeId
    if (!conflict || isSelfCollision) return candidate
    candidate = `${base}-${counter}`
    counter++
  }
}
