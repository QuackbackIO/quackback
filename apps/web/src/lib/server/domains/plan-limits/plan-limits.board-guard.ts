/**
 * The write guard for read-only boards.
 *
 * After the grace, boards over the plan's cap that are not kept open take no
 * new posts, votes or comments from anyone. Every create path reaches one of
 * these two functions through the service that writes the row, so a caller
 * (portal, widget, admin, REST, MCP, assistant, import) is covered by
 * construction. The refusal is neutral on purpose: end users see it, and it
 * never mentions plans or billing.
 *
 * Like the other runtime helpers it fails open: with the flag off, or when the
 * plan limits cannot be read, every board is open.
 */
import { toUuid } from '@quackback/ids'
import type { SQL } from 'drizzle-orm'
import { db, and, boards, eq, isNull, posts, sql } from '@/lib/server/db'
import { notTestPrincipal } from '@/lib/server/test-data'
import { ForbiddenError } from '@/lib/shared/errors'
import { BOARD_READ_ONLY_MESSAGE } from '@/lib/shared/board-read-only'
import type { BoardId, PostId } from '@quackback/ids'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { PLAN_CATALOGUE } from '@/lib/server/domains/settings/cloud/cloud.types'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { loadUsageCounts } from '@/lib/server/domains/billing/usage-counts'
import { evaluate, getPlanLimits, openBoardIds } from './plan-limits.service'

export const BOARD_READ_ONLY_CODE = 'BOARD_READ_ONLY'
export { BOARD_READ_ONLY_MESSAGE }

export class BoardReadOnlyError extends ForbiddenError {
  constructor() {
    super(BOARD_READ_ONLY_CODE, BOARD_READ_ONLY_MESSAGE)
  }
}

export type BoardClosedReason = 'manual' | 'plan'

/** Whether an admin has set the board read-only (a column on the board). */
async function isManuallyReadOnly(boardId: BoardId): Promise<boolean> {
  const [row] = await db
    .select({ readOnly: boards.readOnly })
    .from(boards)
    .where(eq(boards.id, boardId))
    .limit(1)
  return row?.readOnly ?? false
}

/**
 * Why a board takes no new posts, votes or comments, or null when it does. An
 * admin's setting counts on every plan; the plan reason applies only to a board
 * over the plan's board limit that is not kept open. Pass `readOnly` when the
 * board row is already loaded to skip a read.
 */
export async function boardClosedReason(
  boardId: BoardId,
  readOnly?: boolean
): Promise<BoardClosedReason | null> {
  if (readOnly ?? (await isManuallyReadOnly(boardId))) return 'manual'
  const open = await openBoardIds()
  return open !== null && !open.includes(boardId) ? 'plan' : null
}

/**
 * Whether a board takes new feedback, for callers that already hold its row's
 * `readOnly` column (so no board read is needed with the plan limits off).
 */
export async function isBoardOpenFor(boardId: BoardId, readOnly: boolean): Promise<boolean> {
  return (await boardClosedReason(boardId, readOnly)) === null
}

/** Refuses a write to a board that is read-only now, for either reason. */
export async function assertBoardOpen(boardId: BoardId, readOnly?: boolean): Promise<void> {
  if (await boardClosedReason(boardId, readOnly)) throw new BoardReadOnlyError()
}

/** The board that decides a post (a merged post counts on its canonical post's board). */
async function deciderBoard(postId: PostId): Promise<{ id: BoardId; readOnly: boolean } | null> {
  const board = (id: PostId) =>
    db
      .select({
        postBoardId: posts.boardId,
        canonicalPostId: posts.canonicalPostId,
        readOnly: boards.readOnly,
      })
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .where(and(eq(posts.id, id), isNull(posts.deletedAt)))
      .limit(1)
  const [row] = await board(postId)
  if (!row) return null
  if (!row.canonicalPostId) return { id: row.postBoardId, readOnly: row.readOnly }
  const [canonical] = await board(row.canonicalPostId)
  return canonical
    ? { id: canonical.postBoardId, readOnly: canonical.readOnly }
    : { id: row.postBoardId, readOnly: row.readOnly }
}

/** False when the post's board is read-only now. A missing post is left to the caller. */
export async function isPostBoardOpen(postId: PostId): Promise<boolean> {
  const decider = await deciderBoard(postId)
  return decider === null || (await boardClosedReason(decider.id, decider.readOnly)) === null
}

/**
 * The boards the plan keeps open as a uuid array for a vote query, or a null
 * array when it keeps all of them (the flag is off, or nothing is over).
 */
export async function planOpenBoardsSql(): Promise<SQL> {
  const open = await openBoardIds()
  if (open === null) return sql`NULL::uuid[]`
  return sql`ARRAY[${sql.join(
    open.map((id) => sql`${toUuid(id)}::uuid`),
    sql`, `
  )}]::uuid[]`
}

/** Refuses a vote on a post whose board is read-only. */
export async function assertPostBoardOpen(postId: PostId): Promise<void> {
  if (!(await isPostBoardOpen(postId))) throw new BoardReadOnlyError()
}

/**
 * Whether a new post would be refused at the posts cap, as `createPost` counts.
 * With the limits in force this reads the plan limits' cached usage; otherwise
 * it counts, and only when the plan has a posts cap at all.
 */
async function postsCapReached(): Promise<boolean> {
  try {
    const { maxPosts } = await getTierLimits()
    if (maxPosts === null) return false
    if ((await getPlanLimits()).enabled) {
      const { snapshot } = await evaluate({ now: new Date(), persist: false })
      const used = snapshot.usage?.maxPosts
      if (used !== undefined) return used >= maxPosts
    }
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(posts)
      .where(and(isNull(posts.deletedAt), notTestPrincipal(posts.principalId)))
    return (row?.count ?? 0) >= maxPosts
  } catch {
    return false
  }
}

/**
 * What the portal and widget need to draw read-only boards: the boards the plan
 * keeps open (null when it keeps all) and whether new posts are stopped at the
 * posts cap, read only when asked. It names no plan, so it is safe to send to a
 * visitor.
 */
export async function readOnlyBoardState(): Promise<{
  open: string[] | null
  postsPaused: () => Promise<boolean>
}> {
  return { open: await openBoardIds(), postsPaused: postsCapReached }
}

/**
 * Runs a post create for a portal or widget visitor. A refusal at the posts
 * cap reads as the neutral line instead of the upgrade wording, which is for
 * admins. With the plan limits flag off the refusal is left as it is.
 */
export async function withVisitorPostCapCopy<T>(create: () => Promise<T>): Promise<T> {
  try {
    return await create()
  } catch (error) {
    if (error instanceof TierLimitError && error.limit === 'maxPosts' && (await limitsEnabled())) {
      throw new BoardReadOnlyError()
    }
    throw error
  }
}

async function limitsEnabled(): Promise<boolean> {
  try {
    return (await getPlanLimits()).enabled
  } catch {
    return false
  }
}

/**
 * How many more posts and boards an import may add under the plan's caps, with
 * the refusal each cap gives. A null room means no limit: the flag is off, the
 * cap is unlimited, or the counts cannot be read. Imports stop at the caps the
 * same way a single post does.
 */
export interface ImportRoom {
  posts: number | null
  boards: number | null
  postsRefusal: string
  boardsRefusal: string
}

export async function importRoom(): Promise<ImportRoom> {
  const none: ImportRoom = { posts: null, boards: null, postsRefusal: '', boardsRefusal: '' }
  try {
    const limits = await getPlanLimits()
    if (!limits.enabled) return none
    const [tier, used] = await Promise.all([getTierLimits(), loadUsageCounts()])
    const room = (cap: number | null, count: number) =>
      cap === null ? null : Math.max(0, cap - count)
    const plan = limits.plan
      ? `the ${PLAN_CATALOGUE[limits.plan].name} plan`
      : "the workspace's plan"
    const refusal = (cap: number | null, noun: string) =>
      `Not imported: ${plan} allows ${cap} ${noun}.`
    return {
      posts: room(tier.maxPosts, used.maxPosts ?? 0),
      boards: room(tier.maxBoards, used.maxBoards ?? 0),
      postsRefusal: refusal(tier.maxPosts, 'posts'),
      boardsRefusal: refusal(tier.maxBoards, 'boards'),
    }
  } catch {
    return none
  }
}
