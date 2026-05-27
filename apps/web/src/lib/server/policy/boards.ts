/**
 * Board view authorization.
 *
 * Pair every canViewBoard() with a matching boardViewFilter() so list
 * queries and single-row reads use the same predicate.
 */
import { sql, type SQL } from 'drizzle-orm'
import { boards, type BoardAccess, type AccessTier } from '@/lib/server/db'
import { allowDecision, denyDecision, isTeamActor, type Actor, type Decision } from './types'
import { tierAllows } from './access'

function viewDenyMessage(tier: AccessTier): string {
  switch (tier) {
    case 'anonymous':
      // Anonymous tier never denies via this function (tierAllows always returns
      // true), but a message is required by the Decision type's deny variant —
      // service actors hitting an 'anonymous' tier still pass, so this branch
      // is effectively unreachable. Keep a sensible string anyway.
      return 'This board is restricted'
    case 'authenticated':
      return 'Sign in to view this board'
    case 'team':
      return 'This board is internal'
    case 'segments':
      return 'This board is restricted'
  }
}

/** Single-row board read authorization. */
export function canViewBoard(actor: Actor, board: { access: BoardAccess }): Decision {
  return tierAllows(actor, board.access.view, board.access.segmentIds)
    ? allowDecision()
    : denyDecision(viewDenyMessage(board.access.view))
}

/**
 * SQL predicate for board list queries. The row-by-row truthiness must
 * match canViewBoard exactly — invariant test enforces this.
 *
 * Reads from the `access` JSONB column (matching canViewBoard). The legacy
 * `audience` column is still written by the dual-write path for backward
 * compatibility but is no longer read here.
 */
export function boardViewFilter(actor: Actor): SQL {
  if (isTeamActor(actor)) {
    return sql`true`
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
        ${boards.access}->>'view' = 'segments'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(${boards.access}->'segmentIds') seg
          WHERE seg = ANY(ARRAY[${sql.join(
            memberIds.map((id) => sql`${id}`),
            sql`, `
          )}]::text[])
        )
      `
      : sql`false`
  return sql`
    (
      ${boards.access}->>'view' = 'anonymous'
      OR (${boards.access}->>'view' = 'authenticated' AND ${isUser})
      OR (${segmentsMatch})
    )
  `
}
