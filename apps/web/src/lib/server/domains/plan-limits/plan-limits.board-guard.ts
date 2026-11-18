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
import { db, and, eq, isNull, posts, sql } from '@/lib/server/db'
import { notTestPrincipal } from '@/lib/server/test-data'
import { ForbiddenError } from '@/lib/shared/errors'
import { BOARD_READ_ONLY_MESSAGE } from '@/lib/shared/board-read-only'
import type { BoardId, PostId } from '@quackback/ids'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { loadUsageCounts } from '@/lib/server/domains/billing/usage-counts'
import { getPlanLimits, openBoardIds } from './plan-limits.service'

export const BOARD_READ_ONLY_CODE = 'BOARD_READ_ONLY'
export { BOARD_READ_ONLY_MESSAGE }

export class BoardReadOnlyError extends ForbiddenError {
  constructor() {
    super(BOARD_READ_ONLY_CODE, BOARD_READ_ONLY_MESSAGE)
  }
}

/** Refuses a write to a board that is read-only now. */
export async function assertBoardOpen(boardId: BoardId): Promise<void> {
  const open = await openBoardIds()
  if (open !== null && !open.includes(boardId)) throw new BoardReadOnlyError()
}

/** The board that decides a post: a merged post counts on its canonical post's board. */
async function deciderBoardId(postId: PostId): Promise<BoardId | null> {
  const [row] = await db
    .select({ boardId: posts.boardId, canonicalPostId: posts.canonicalPostId })
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt)))
    .limit(1)
  if (!row) return null
  if (!row.canonicalPostId) return row.boardId
  const [canonical] = await db
    .select({ boardId: posts.boardId })
    .from(posts)
    .where(eq(posts.id, row.canonicalPostId))
    .limit(1)
  return canonical?.boardId ?? row.boardId
}

/** False when the post's board is read-only now. A missing post is left to the caller. */
export async function isPostBoardOpen(postId: PostId): Promise<boolean> {
  const open = await openBoardIds()
  if (open === null) return true
  const boardId = await deciderBoardId(postId)
  return boardId === null || open.includes(boardId)
}

/** Refuses a vote on a post whose board is read-only. */
export async function assertPostBoardOpen(postId: PostId): Promise<void> {
  if (!(await isPostBoardOpen(postId))) throw new BoardReadOnlyError()
}

/** Whether a new post would be refused at the posts cap, counted as `createPost` counts. */
async function postsCapReached(): Promise<boolean> {
  try {
    const { maxPosts } = await getTierLimits()
    if (maxPosts === null) return false
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
 * What the portal and widget need to draw read-only boards: the boards that
 * stay open (null when all do) and whether new posts are stopped at the posts
 * cap. It names no plan, so it is safe to send to a visitor.
 */
export async function readOnlyBoardState(): Promise<{
  open: string[] | null
  postsPaused: boolean
}> {
  const open = await openBoardIds()
  if (open === null) return { open: null, postsPaused: false }
  const postsPaused = await postsCapReached()
  return { open, postsPaused }
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
 * How many more posts and boards an import may add under the plan's caps. Null
 * means no limit: the flag is off, the cap is unlimited, or the counts cannot
 * be read. Imports stop at the caps the same way a single post does.
 */
export async function importRoom(): Promise<{ posts: number | null; boards: number | null }> {
  try {
    if (!(await getPlanLimits()).enabled) return { posts: null, boards: null }
    const [tier, used] = await Promise.all([getTierLimits(), loadUsageCounts()])
    const room = (cap: number | null, count: number) =>
      cap === null ? null : Math.max(0, cap - count)
    return {
      posts: room(tier.maxPosts, used.maxPosts ?? 0),
      boards: room(tier.maxBoards, used.maxBoards ?? 0),
    }
  } catch {
    return { posts: null, boards: null }
  }
}
