/**
 * Read-only boards in a CSV import. The commit path writes posts and boards
 * directly, so it never reaches the services that refuse a read-only board;
 * these helpers apply the same rule per row. A refused row writes nothing,
 * including no one to vote on it.
 */
import { db, inArray, posts } from '@/lib/server/db'
import { openBoardIds } from '@/lib/server/domains/plan-limits/plan-limits.service'
import { BOARD_READ_ONLY_MESSAGE } from '@/lib/server/domains/plan-limits/plan-limits.board-guard'
import type { PostId } from '@quackback/ids'
import type { BatchResult } from './import-service'
import type { ResolvedRow, RowContext } from './import-row-resolver'

export interface ClosedBoards {
  /** Boards the plan keeps open; null when it keeps all of them. */
  open: string[] | null
  isClosed: (boardId: string) => boolean
}

export async function loadClosedBoards(ctx: RowContext): Promise<ClosedBoards> {
  const open = await openBoardIds()
  return {
    open,
    isClosed: (boardId) =>
      ctx.readOnlyBoardIds.has(boardId) || (open !== null && !open.includes(boardId)),
  }
}

/** Records a refused row on the batch result. */
export function refuseRow(result: BatchResult, row: number, message = BOARD_READ_ONLY_MESSAGE) {
  result.errors.push({ row, message, field: 'board' })
  result.skipped++
}

/**
 * Drops the rows aimed at a read-only board, or at a board that was not
 * created because new boards are not kept open, whether they would create or
 * update a post.
 */
export function refuseRowsOnClosedBoards(
  validRows: ResolvedRow[],
  ctx: RowContext,
  closed: ClosedBoards,
  result: BatchResult
): void {
  for (let i = validRows.length - 1; i >= 0; i--) {
    const { row, index } = validRows[i]
    const notCreated = row.pendingBoardSlug !== null && !ctx.boardMap.has(row.pendingBoardSlug)
    if ((notCreated && closed.open !== null) || (!notCreated && closed.isClosed(row.boardId))) {
      validRows.splice(i, 1)
      refuseRow(result, index)
    }
  }
}

/** Drops the updates of posts that already sit on a read-only board. */
export async function refuseUpdatesOnClosedBoards(
  toUpdate: ResolvedRow[],
  existingBySourceId: Map<string, PostId>,
  ctx: RowContext,
  closed: ClosedBoards,
  result: BatchResult
): Promise<void> {
  if ((closed.open === null && ctx.readOnlyBoardIds.size === 0) || toUpdate.length === 0) return
  const boardOf = new Map(
    (
      await db
        .select({ id: posts.id, boardId: posts.boardId })
        .from(posts)
        .where(inArray(posts.id, [...existingBySourceId.values()]))
    ).map((post) => [post.id, post.boardId])
  )
  for (let i = toUpdate.length - 1; i >= 0; i--) {
    const boardId = boardOf.get(existingBySourceId.get(toUpdate[i].row.sourceId!)!)
    if (boardId && closed.isClosed(boardId)) refuseRow(result, toUpdate.splice(i, 1)[0].index)
  }
}
