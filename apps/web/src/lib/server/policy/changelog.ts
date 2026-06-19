/**
 * Changelog view authorization.
 *
 * Audience visibility for changelog entries — the view-only mirror of the
 * board/roadmap policy. This is orthogonal to publish lifecycle: the public
 * read paths still apply the published-and-not-deleted filter separately. Pair
 * every canViewChangelog() with a matching changelogViewFilter() so list
 * queries and single-row reads agree — the parity test enforces this.
 *
 * The full AccessTier surface is supported (Public / Signed-in / Segments /
 * Private), matching the roadmap policy.
 */
import { sql, type SQL } from 'drizzle-orm'
import { changelogEntries, type ChangelogAccess, type AccessTier } from '@/lib/server/db'
import { allowDecision, denyDecision, isTeamActor, type Actor, type Decision } from './types'
import { tierAllows } from './access'

function viewDenyMessage(tier: AccessTier): string {
  switch (tier) {
    case 'anonymous':
      return 'This changelog entry is restricted'
    case 'authenticated':
      return 'Sign in to view this changelog entry'
    case 'team':
      return 'This changelog entry is internal'
    case 'segments':
      return 'This changelog entry is restricted'
  }
}

/** Single-row changelog read authorization. */
export function canViewChangelog(actor: Actor, entry: { access: ChangelogAccess }): Decision {
  return tierAllows(actor, entry.access.view, entry.access.segments.view)
    ? allowDecision()
    : denyDecision(viewDenyMessage(entry.access.view))
}

/**
 * SQL predicate for changelog list queries. The row-by-row truthiness must
 * match canViewChangelog exactly — invariant test enforces this.
 *
 * Unlike boards/roadmaps this filter does NOT AND in `isNull(deletedAt)`: the
 * public changelog readers compose it alongside their own published-and-not-
 * deleted predicates (publicChangelogConditions), so adding deletedAt here
 * would be redundant. It is purely the audience gate.
 */
export function changelogViewFilter(actor: Actor): SQL {
  if (isTeamActor(actor)) {
    return sql`true`
  }
  const memberIds = Array.from(actor.segmentIds) as string[]
  const isUser = actor.principalType === 'user'
  // The segments branch can only match a user principal who belongs to a
  // listed segment (matches tierAllows). With no memberships, collapse to a
  // constant — this also avoids rendering `ANY(()::text[])`, which Postgres
  // rejects. A non-empty list is built as `ARRAY[$1, …]` because a bare array
  // in a `sql` template is spread as comma-separated params, not an array.
  const segmentsMatch =
    memberIds.length > 0 && isUser
      ? sql`
        ${changelogEntries.access}->>'view' = 'segments'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(${changelogEntries.access}->'segments'->'view') seg
          WHERE seg = ANY(ARRAY[${sql.join(
            memberIds.map((id) => sql`${id}`),
            sql`, `
          )}]::text[])
        )
      `
      : sql`false`
  return sql`
    (
      ${changelogEntries.access}->>'view' = 'anonymous'
      OR (${changelogEntries.access}->>'view' = 'authenticated' AND ${isUser})
      OR (${segmentsMatch})
    )
  `
}
