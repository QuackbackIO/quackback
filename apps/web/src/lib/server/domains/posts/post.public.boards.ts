import { alias } from 'drizzle-orm/pg-core'
import { and, db, inArray, isNull, notExists, or, sql, boards, posts } from '@/lib/server/db'
import type { BoardId } from '@quackback/ids'

/**
 * Narrows a post list to the chosen boards, in the same query. Only public
 * boards count: one that is private or deleted adds nothing, and an unknown id
 * matches nothing. When none of the chosen boards remains, every board is
 * shown, so a board removed later never leaves the block empty. The viewer's
 * own audience filter still applies on top.
 */
export function chosenBoardsCondition(boardIds: readonly BoardId[]) {
  const chosen = alias(boards, 'chosen_boards')
  const stillPublic = db
    .select({ id: chosen.id })
    .from(chosen)
    .where(
      and(
        inArray(chosen.id, [...boardIds]),
        isNull(chosen.deletedAt),
        sql`${chosen.access}->>'view' = 'anonymous'`
      )
    )
  return or(
    and(inArray(posts.boardId, [...boardIds]), sql`${boards.access}->>'view' = 'anonymous'`),
    notExists(stillPublic)
  )!
}
