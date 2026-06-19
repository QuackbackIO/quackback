/**
 * Roadmap view authorization.
 *
 * Roadmaps have a single `view` action (no vote/comment/submit), so this is
 * the view-only mirror of the board policy. Pair every canViewRoadmap() with a
 * matching roadmapViewFilter() so list queries and single-row reads use the
 * same predicate — the parity test enforces they agree row-by-row.
 */
import { sql, isNull, type SQL } from 'drizzle-orm'
import { roadmaps, type RoadmapAccess, type AccessTier } from '@/lib/server/db'
import { allowDecision, denyDecision, isTeamActor, type Actor, type Decision } from './types'
import { tierAllows } from './access'

function viewDenyMessage(tier: AccessTier): string {
  switch (tier) {
    case 'anonymous':
      // Anonymous tier never denies via this function (tierAllows always
      // returns true). Kept for exhaustiveness with the Decision deny variant.
      return 'This roadmap is restricted'
    case 'authenticated':
      return 'Sign in to view this roadmap'
    case 'team':
      return 'This roadmap is internal'
    case 'segments':
      return 'This roadmap is restricted'
  }
}

/** Single-row roadmap read authorization. */
export function canViewRoadmap(actor: Actor, roadmap: { access: RoadmapAccess }): Decision {
  return tierAllows(actor, roadmap.access.view, roadmap.access.segments.view)
    ? allowDecision()
    : denyDecision(viewDenyMessage(roadmap.access.view))
}

/**
 * SQL predicate for roadmap list queries. The row-by-row truthiness must
 * match canViewRoadmap exactly — invariant test enforces this.
 *
 * Every branch is AND-ed with `isNull(roadmaps.deletedAt)`: a soft-deleted
 * roadmap must never surface through any public reader path, regardless of
 * actor (even team members viewing the portal see only non-deleted roadmaps;
 * admin-side queries do not use this filter and have their own logic).
 */
export function roadmapViewFilter(actor: Actor): SQL {
  if (isTeamActor(actor)) {
    return sql`${isNull(roadmaps.deletedAt)}`
  }
  const memberIds = Array.from(actor.segmentIds) as string[]
  const isUser = actor.principalType === 'user'
  // The segments branch can only match an actor who belongs to a segment AND
  // is a user principal (matches tierAllows semantics — a service principal
  // in a segment is denied). With no memberships, collapse to a constant —
  // this also avoids rendering `ANY(()::text[])`, which Postgres rejects. A
  // non-empty list is built as `ARRAY[$1, …]` because a bare array in a
  // `sql` template is spread as comma-separated params, not a single array
  // literal.
  const segmentsMatch =
    memberIds.length > 0 && isUser
      ? sql`
        ${roadmaps.access}->>'view' = 'segments'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(${roadmaps.access}->'segments'->'view') seg
          WHERE seg = ANY(ARRAY[${sql.join(
            memberIds.map((id) => sql`${id}`),
            sql`, `
          )}]::text[])
        )
      `
      : sql`false`
  return sql`
    (
      ${isNull(roadmaps.deletedAt)}
      AND (
        ${roadmaps.access}->>'view' = 'anonymous'
        OR (${roadmaps.access}->>'view' = 'authenticated' AND ${isUser})
        OR (${segmentsMatch})
      )
    )
  `
}
