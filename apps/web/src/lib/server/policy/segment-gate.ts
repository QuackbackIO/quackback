/**
 * Shared segment-gate primitive: the "segment list, [] = everyone" audience
 * mechanism used by changelog categories, status components, and help-center
 * categories.
 *
 * Semantics (all three surfaces agree):
 *   - Team actors (admin/member) bypass the gate entirely.
 *   - An empty `segmentIds` list means the row is visible to everyone.
 *   - A non-empty list admits only signed-in user principals sharing at
 *     least one listed segment. Anonymous and service principals are denied
 *     (a viewer that cannot be resolved NEVER sees restricted content).
 *
 * Per `policy/types.ts`'s convention the row check is paired with a SQL
 * predicate builder so single-row reads and list queries can't drift.
 */
import { sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { isTeamActor, type Actor } from './types'

/** Single-row segment gate. `segmentIds` is the row's jsonb string-array. */
export function segmentGateAllows(actor: Actor, segmentIds: readonly string[]): boolean {
  if (isTeamActor(actor)) return true
  if (segmentIds.length === 0) return true
  return (
    actor.principalType === 'user' && segmentIds.some((id) => actor.segmentIds.has(id as never))
  )
}

/**
 * SQL predicate over a jsonb string-array column (e.g.
 * `statusComponents.segmentIds`), or a pre-rendered SQL reference to one for
 * contexts where a column object would be alias-rewritten (see
 * publicCategoryExistsCondition). Row-by-row truthiness must match
 * {@link segmentGateAllows} exactly.
 */
export function segmentGateFilter(actor: Actor, segmentIdsColumn: AnyPgColumn | SQL): SQL {
  if (isTeamActor(actor)) return sql`true`

  const memberIds = Array.from(actor.segmentIds) as string[]
  const isUser = actor.principalType === 'user'
  // See boardViewFilter (policy/boards.ts) for why the empty-membership case
  // must collapse to a constant instead of rendering `ANY(()::text[])`.
  const segmentsMatch =
    memberIds.length > 0 && isUser
      ? sql`
        EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(${segmentIdsColumn}) seg
          WHERE seg = ANY(ARRAY[${sql.join(
            memberIds.map((id) => sql`${id}`),
            sql`, `
          )}]::text[])
        )
      `
      : sql`false`

  return sql`(jsonb_array_length(${segmentIdsColumn}) = 0 OR (${segmentsMatch}))`
}
