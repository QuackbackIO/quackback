/**
 * Status component view authorization — Layer 2 of the visibility model
 * (Status Product Spec §4): per-component audience narrowing via
 * `statusComponents.segmentIds` ([] = everyone who passed the page-level
 * gate in `domains/status/status.audience.ts`).
 *
 * A status page has exactly one viewer action (view/subscribe), so unlike
 * `policy/boards.ts` this returns a plain boolean rather than a `Decision` —
 * there's no per-action matrix to disambiguate (Status Product Spec §4).
 * Still paired per `policy/types.ts`'s convention: pair every canX() with a
 * matching xFilter() so row checks and list queries can't drift.
 */
import { sql, type SQL } from 'drizzle-orm'
import { statusComponents } from '@/lib/server/db'
import { isTeamActor, type Actor } from './types'

/** Single-row status component view authorization. */
export function canViewStatusComponent(actor: Actor, component: { segmentIds: string[] }): boolean {
  if (isTeamActor(actor)) return true
  if (component.segmentIds.length === 0) return true
  return (
    actor.principalType === 'user' &&
    component.segmentIds.some((id) => actor.segmentIds.has(id as never))
  )
}

/**
 * SQL predicate for status component list queries. Row-by-row truthiness
 * must match `canViewStatusComponent` exactly.
 */
export function statusComponentViewFilter(actor: Actor): SQL {
  if (isTeamActor(actor)) return sql`true`

  const memberIds = Array.from(actor.segmentIds) as string[]
  const isUser = actor.principalType === 'user'
  // See boardViewFilter (policy/boards.ts) for why the empty-membership case
  // must collapse to a constant instead of rendering `ANY(()::text[])`.
  const segmentsMatch =
    memberIds.length > 0 && isUser
      ? sql`
        EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(${statusComponents.segmentIds}) seg
          WHERE seg = ANY(ARRAY[${sql.join(
            memberIds.map((id) => sql`${id}`),
            sql`, `
          )}]::text[])
        )
      `
      : sql`false`

  return sql`(jsonb_array_length(${statusComponents.segmentIds}) = 0 OR (${segmentsMatch}))`
}
