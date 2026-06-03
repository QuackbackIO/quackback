/**
 * Per-post access assertions for write paths.
 *
 * Read paths already gate via `getPublicBoardById(boardId, actor)` and
 * `getPublicPostDetail(postId, actor)` — both apply `canViewBoard` /
 * `canViewPost` internally. Write paths (vote, comment, reaction, edit,
 * delete) used to gate only on portal-access + the actor's role, NOT on
 * whether the actor was entitled to view the target post under its
 * board's audience / moderation state. That let an authenticated portal
 * user mutate posts on team-only boards if they could guess an id.
 *
 * `assertPostViewable` is the chokepoint: every write handler that
 * accepts a post id must call this before any mutation. It throws a
 * NotFoundError-shaped error (don't leak existence to denied callers).
 */
import { db, eq, and, isNull, posts, boards, comments } from '@/lib/server/db'
import { type CommentId, type PostId } from '@quackback/ids'
import { NotFoundError, ForbiddenError } from '@/lib/shared/errors'
import { canViewPost, canVotePost, isTeamActor, type Actor } from '@/lib/server/policy'

/**
 * Resolve a post's board `access` matrix for capability gates, applying the
 * same soft-delete predicate as the assert chokepoints. Returns null when the
 * post / board doesn't exist or is soft-deleted — callers map that to their
 * denied/empty response. Centralizing this join keeps the audience gate sound:
 * the INNER + isNull predicate can't drift between the read paths that compose
 * `boardCapabilitiesForActor` / `canVotePost` off `boards.access`.
 */
export async function loadBoardAccessForPost(postId: PostId) {
  const rows = await db
    .select({ access: boards.access })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt), isNull(boards.deletedAt)))
    .limit(1)
  return rows[0]?.access ?? null
}

export async function assertPostViewable(postId: PostId, actor: Actor): Promise<void> {
  // Fetch only the fields the policy needs. Soft-deleted post or board
  // is treated as "doesn't exist" — the join uses INNER + isNull
  // guards so any null falls into the !row branch below.
  const rows = await db
    .select({
      moderationState: posts.moderationState,
      principalId: posts.principalId,
      access: boards.access,
    })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt), isNull(boards.deletedAt)))
    .limit(1)

  const row = rows[0]
  if (!row) {
    throw new NotFoundError('POST_NOT_FOUND', `Post ${postId} not found`)
  }

  const decision = canViewPost(
    actor,
    { moderationState: row.moderationState, principalId: row.principalId },
    { access: row.access }
  )
  if (!decision.allowed) {
    // 404-shape on deny so we don't leak existence to a denied caller.
    throw new NotFoundError('POST_NOT_FOUND', `Post ${postId} not found`)
  }
}

/**
 * Vote-write chokepoint. Composes:
 *  - `canViewPost` (audience + moderation + own-pending), 404 on deny.
 *  - `canVotePost` (board.access.vote tier), 403 on deny — the post is
 *    visible to the caller, so leaking existence isn't a concern; the
 *    "Sign in to vote on this board" / "Only specific groups…" hint is
 *    deliberately surfaced.
 *
 * The workspace `features.allowAnonymous` master switch is composed by
 * the caller — this chokepoint is the per-board policy gate only.
 */
export async function assertPostVotable(postId: PostId, actor: Actor): Promise<void> {
  const rows = await db
    .select({
      moderationState: posts.moderationState,
      principalId: posts.principalId,
      access: boards.access,
    })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt), isNull(boards.deletedAt)))
    .limit(1)

  const row = rows[0]
  if (!row) {
    throw new NotFoundError('POST_NOT_FOUND', `Post ${postId} not found`)
  }

  const decision = canVotePost(
    actor,
    { moderationState: row.moderationState, principalId: row.principalId },
    { access: row.access }
  )
  if (!decision.allowed) {
    // Distinguish view-deny (404) from vote-deny (403). canVotePost
    // already runs canViewPost internally, so a view denial gets the
    // NotFoundError shape — only "viewable but not votable" lands here.
    const viewDecision = canViewPost(
      actor,
      { moderationState: row.moderationState, principalId: row.principalId },
      { access: row.access }
    )
    if (!viewDecision.allowed) {
      throw new NotFoundError('POST_NOT_FOUND', `Post ${postId} not found`)
    }
    throw new ForbiddenError('VOTE_NOT_ALLOWED', decision.reason)
  }
}

/**
 * Same chokepoint for comment-targeted mutations (userEditCommentFn /
 * userDeleteCommentFn / reaction toggles). Resolves the comment's post
 * + board in one query and:
 *
 *   1. 404s when comment / post / board is soft-deleted.
 *   2. Runs the actor through `canViewPost` (audience + moderation +
 *      own-pending).
 *   3. Refuses non-team actors on private comments.
 *
 * Throws NotFoundError on every deny path so the response shape is
 * uniform — denied callers can't probe existence by varying inputs.
 */
export async function assertCommentViewable(commentId: CommentId, actor: Actor): Promise<void> {
  const rows = await db
    .select({
      isPrivate: comments.isPrivate,
      postModerationState: posts.moderationState,
      postPrincipalId: posts.principalId,
      access: boards.access,
    })
    .from(comments)
    .innerJoin(posts, eq(comments.postId, posts.id))
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .where(
      and(
        eq(comments.id, commentId),
        isNull(comments.deletedAt),
        isNull(posts.deletedAt),
        isNull(boards.deletedAt)
      )
    )
    .limit(1)

  const row = rows[0]
  if (!row) {
    throw new NotFoundError('COMMENT_NOT_FOUND', `Comment ${commentId} not found`)
  }

  const decision = canViewPost(
    actor,
    { moderationState: row.postModerationState, principalId: row.postPrincipalId },
    { access: row.access }
  )
  if (!decision.allowed) {
    throw new NotFoundError('COMMENT_NOT_FOUND', `Comment ${commentId} not found`)
  }

  // Private comments are team-only. Non-team actors must not even know
  // the comment exists — same NotFoundError shape.
  if (row.isPrivate && !isTeamActor(actor)) {
    throw new NotFoundError('COMMENT_NOT_FOUND', `Comment ${commentId} not found`)
  }
}
