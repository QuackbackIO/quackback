/**
 * Post view + create authorization.
 *
 * Composes with policy.boards — a post is never visible if its board
 * isn't visible, and create is always denied when view is denied.
 */
import { and, eq, or, sql, type SQL } from 'drizzle-orm'
import {
  posts,
  type AccessTier,
  type BoardAccess,
  type ModerationRuleValue,
  type ModerationState,
} from '@/lib/server/db'
// Imported through the client-safe re-export, not '@/lib/server/db': this is a
// pure helper, and pulling it from the db barrel would make every suite that
// mocks that barrel have to stub it.
import { resolveReplyPolicy } from '@/lib/shared/db-types'
import type { PrincipalId } from '@quackback/ids'
import { allowDecision, denyDecision, isTeamActor, type Actor, type Decision } from './types'
import { can } from './authorize'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { canViewBoard, boardViewFilter } from './boards'
import { tierAllows } from './access'
import { resolveWorkspaceModeration, type ModerationAxis } from '@/lib/shared/moderation-policy'
import { normalizeBoardAccess } from '@/lib/shared/schemas/boards'

/** The workspace moderation policy — the fallback that per-board
 *  `moderation` rules resolve against when set to `'inherit'`. */
export type RequireApproval = 'none' | 'anonymous' | 'authenticated' | 'all'

/**
 * Resolve a per-board tri-state moderation rule against the workspace
 * default. Returns whether the matching submission should be HELD for
 * review (`'on'`) or allowed straight through (`'off'`).
 *
 * - `'on'`  → always hold (override on)
 * - `'off'` → never hold (override off)
 * - `'inherit'` → defer to workspace `requireApproval`:
 *     - `'none'`         → all axes resolve to `'off'`
 *     - `'anonymous'`    → anonPosts on; signedPosts/comments off
 *     - `'authenticated'`→ signedPosts on; anonPosts/comments off
 *     - `'all'`          → all axes resolve to `'on'`
 *
 * Note: today's workspace setting doesn't distinguish post-moderation
 * from comment-moderation. Until that lands, comments inherit-resolve to
 * `'on'` only when workspace=`'all'` and `'off'` otherwise — i.e. only
 * the most-strict workspace value implicitly covers comments.
 */
export function resolveModerationRule(
  rule: ModerationRuleValue,
  workspaceApproval: RequireApproval | undefined,
  axis: ModerationAxis
): 'on' | 'off' {
  if (rule === 'on') return 'on'
  if (rule === 'off') return 'off'
  // 'inherit' — resolve via the shared workspace-default helper (single
  // source of truth for the axis × level mapping; also used by the UI).
  return resolveWorkspaceModeration(axis, workspaceApproval)
}

interface PostShape {
  moderationState: ModerationState
  principalId?: PrincipalId | null
}

interface BoardShape {
  access: BoardAccess
}

function accessOf(board: BoardShape): BoardAccess {
  return normalizeBoardAccess(board.access)
}

const isTeam = isTeamActor

export function canViewPost(actor: Actor, post: PostShape, board: BoardShape): Decision {
  const boardDecision = canViewBoard(actor, board)
  if (!boardDecision.allowed) return boardDecision

  // Seeing unpublished / private posts is the post.view_private capability.
  if (can(actor, PERMISSIONS.POST_VIEW_PRIVATE)) {
    return post.moderationState === 'deleted' ? denyDecision('Post was removed') : allowDecision()
  }

  if (post.moderationState === 'published') return allowDecision()
  if (
    post.moderationState === 'pending' &&
    actor.principalId &&
    post.principalId === actor.principalId
  ) {
    return allowDecision()
  }
  return denyDecision('Post is not yet visible')
}

/**
 * SQL predicate for post list queries. Caller must join `boards` so
 * that boards.access is resolvable. The predicate composes WITH
 * `isNull(posts.deletedAt)` from existing list queries — never replaces it.
 */
export function postViewFilter(actor: Actor): SQL {
  if (can(actor, PERMISSIONS.POST_VIEW_PRIVATE)) {
    return sql`${posts.moderationState} <> 'deleted'`
  }
  const principalIdParam: string | null = actor.principalId ?? null
  const ownPending =
    principalIdParam !== null
      ? and(eq(posts.moderationState, 'pending'), eq(posts.principalId, principalIdParam as never))
      : sql`false`
  return and(boardViewFilter(actor), or(eq(posts.moderationState, 'published'), ownPending))!
}

export type CommentCreateDecision =
  { allowed: true; requiresApproval: boolean } | { allowed: false; reason: string }

/** Action-specific copy for the (unreachable) anonymous deny branch. */
const ANON_DENY_MESSAGE: Record<'comment' | 'vote' | 'submit', string> = {
  comment: 'Commenting is not allowed on this board',
  vote: 'Voting is not allowed on this board',
  submit: 'Submissions are not accepted on this board',
}

/**
 * Denial copy for a board action the actor's tier doesn't satisfy. The
 * authenticated/segments/team branches differ only by the action verb; the
 * anonymous branch is unreachable in practice (`tierAllows('anonymous', …)`
 * always passes) but carries action-specific copy.
 */
function tierDenyMessage(action: 'comment' | 'vote' | 'submit', tier: AccessTier): string {
  switch (tier) {
    case 'anonymous':
      return ANON_DENY_MESSAGE[action]
    case 'authenticated':
      return `Sign in to ${action} on this board`
    case 'segments':
      return `Only specific groups can ${action} on this board`
    case 'team':
      return `Only team members can ${action} on this board`
  }
}

/**
 * Whether the requesting actor can post a comment on a post.
 *
 * Rules (applied in order):
 * 1. The actor must be able to view the post (board view tier + moderation state).
 * 2. The actor must satisfy the board's comment tier — independent of view
 *    (a board can be public-to-view but team-only-to-comment).
 * 3. On an `author-only` board, only the post's own author and team members
 *    may reply — everyone else reads the thread without being able to answer.
 * 4. If comments are locked, only team members may bypass.
 *
 * On the allowed branch, `requiresApproval` is true when the actor is not
 * a team member AND the board's `moderation.comments` rule (resolved
 * against the workspace default for `'inherit'`) is `'on'`.
 */
export function canCreateComment(
  actor: Actor,
  post: PostShape & { isCommentsLocked: boolean },
  board: BoardShape,
  workspaceApproval: RequireApproval | undefined
): CommentCreateDecision {
  const view = canViewPost(actor, post, board)
  if (!view.allowed) return { allowed: false, reason: view.reason }

  const access = accessOf(board)
  if (!tierAllows(actor, access.comment, access.segments.comment)) {
    return { allowed: false, reason: tierDenyMessage('comment', access.comment) }
  }
  // Author-only board: the thread belongs to its author, so only they and the
  // team may reply. Authorship is principalId VALUE equality guarded on a
  // non-null actor principal — the same guard canViewPost's own-pending hatch
  // uses, and for the same reason: without it an anonymous viewer (null) would
  // match every anonymously-authored post (null) and inherit the author's
  // reply right. An actor with no principal therefore always lands on the deny.
  if (resolveReplyPolicy(access) === 'author-only' && !isTeam(actor)) {
    const isAuthor = !!actor.principalId && actor.principalId === post.principalId
    if (!isAuthor) {
      return {
        allowed: false,
        reason: 'Only the post author and team members can reply on this board',
      }
    }
  }
  if (post.isCommentsLocked && !isTeam(actor)) {
    return { allowed: false, reason: 'Comments are locked on this post' }
  }
  return {
    allowed: true,
    requiresApproval:
      !isTeam(actor) &&
      resolveModerationRule(access.moderation.comments, workspaceApproval, 'comments') === 'on',
  }
}

export type VoteDecision = { allowed: true } | { allowed: false; reason: string }

/**
 * Whether the requesting actor can vote on a post.
 *
 * Rules (applied in order):
 * 1. The actor must be able to view the post (board view tier + moderation state).
 * 2. The actor must satisfy the board's vote tier — independent of view
 *    (a board can be public-to-view but authenticated-only-to-vote, the
 *    modern-SaaS "Public" preset).
 *
 * The workspace `features.allowAnonymous` master switch is composed
 * separately by the caller — this policy is the per-board check.
 */
export function canVotePost(actor: Actor, post: PostShape, board: BoardShape): VoteDecision {
  const view = canViewPost(actor, post, board)
  if (!view.allowed) return { allowed: false, reason: view.reason }

  const access = accessOf(board)
  if (!tierAllows(actor, access.vote, access.segments.vote)) {
    return { allowed: false, reason: tierDenyMessage('vote', access.vote) }
  }
  return { allowed: true }
}

export type CreateDecision =
  { allowed: true; requiresApproval: boolean } | { allowed: false; reason: string }

export function canCreatePost(
  actor: Actor,
  board: BoardShape,
  workspaceApproval: RequireApproval | undefined
): CreateDecision {
  // View is a precondition (file invariant: create is denied when view is
  // denied) — mirrors canVotePost / canCreateComment, which both gate on view
  // first. The schema lets the per-action segment lists differ while only
  // pinning submit.rank >= view.rank, so a member of the submit segment can
  // sit outside the view segment; without this gate they could create a post
  // on a board they cannot see.
  const view = canViewBoard(actor, board)
  if (!view.allowed) return { allowed: false, reason: view.reason }

  // Submit is then its own decision on top of view — a board can be public to
  // view but team-only to submit (admin-curated roadmap pattern), so the tier
  // check stays independent rather than collapsing into canViewBoard.
  const access = accessOf(board)
  if (!tierAllows(actor, access.submit, access.segments.submit)) {
    return { allowed: false, reason: tierDenyMessage('submit', access.submit) }
  }

  // Team always bypasses the moderation queue.
  if (isTeam(actor)) {
    return { allowed: true, requiresApproval: false }
  }

  // Pick the axis from the actor's principal type: anonymous (or service —
  // non-user principal) maps to the anonPosts rule, signed-in portal users
  // map to signedPosts. The rule is then resolved against the workspace
  // default for `inherit`.
  const isAnon = actor.principalType !== 'user'
  const rule = isAnon ? access.moderation.anonPosts : access.moderation.signedPosts
  const resolved = resolveModerationRule(
    rule,
    workspaceApproval,
    isAnon ? 'anonPosts' : 'signedPosts'
  )
  return { allowed: true, requiresApproval: resolved === 'on' }
}

export interface BoardCapabilities {
  canSubmit: boolean
  canVote: boolean
  canComment: boolean
}

/**
 * Whether the workspace anonymous master switch applies to this actor. Team
 * actors are never gated by it (tierAllows already bypasses for them), so the
 * !isTeam guard is part of the question — a hypothetical non-user team actor
 * (e.g. a service principal carrying a team role) must stay ungated.
 */
function isAnonCeilinged(actor: Actor): boolean {
  return !isTeam(actor) && actor.principalType !== 'user'
}

/**
 * Per-board submit/vote/comment capability for a viewer, composed with the
 * workspace anonymous master switch. This is the single source of truth the
 * portal + widget UIs use to decide whether to advertise the submit/vote/comment
 * CTAs — the server sends the booleans so the client never re-derives them from
 * the workspace flag and advertises an action the board's per-action tier would
 * reject (Codex #191).
 *
 * `allowAnonymous` is the workspace switch (collapsed from the legacy
 * anonymousVoting/anonymousPosting flags in migration 0084). It is the outer
 * ceiling for non-user (anonymous / no-session) actors only — a real portal
 * user or team member is gated purely by the per-board tier.
 */
export function boardCapabilitiesForActor(
  actor: Actor,
  access: BoardAccess,
  allowAnonymous: boolean
): BoardCapabilities {
  const board: BoardShape = { access: normalizeBoardAccess(access) }
  const canSubmit = canCreatePost(actor, board, undefined).allowed
  // canVotePost / canCreateComment compose canViewPost; pass a published,
  // unauthored post so each decision reflects its own tier (callers already
  // filtered to viewable). isCommentsLocked is a per-post UI concern, not a
  // board capability, so it stays false here.
  const canVote = canVotePost(
    actor,
    { moderationState: 'published', principalId: null },
    board
  ).allowed
  // `replyPolicy` is dropped for the same reason isCommentsLocked stays false:
  // it is a per-post concern, not a board capability. On an author-only board a
  // non-team user CAN still reply — on their own post — so the board-level
  // answer stays tier-based and the per-post truth comes from canCommentOnPost.
  const { replyPolicy: _replyPolicy, ...commentAccess } = board.access
  const canComment = canCreateComment(
    actor,
    { moderationState: 'published', principalId: null, isCommentsLocked: false },
    { access: commentAccess },
    undefined
  ).allowed
  // Compose the workspace anonymous ceiling for non-user actors only.
  if (isAnonCeilinged(actor)) {
    return {
      canSubmit: canSubmit && allowAnonymous,
      canVote: canVote && allowAnonymous,
      canComment: canComment && allowAnonymous,
    }
  }
  return { canSubmit, canVote, canComment }
}

/**
 * Per-POST comment capability for a viewer — what the portal/widget composer
 * is actually gated on. Same composition as `boardCapabilitiesForActor`'s
 * `canComment` (board comment tier + the workspace anonymous ceiling), plus
 * the one input a board-level answer structurally cannot have: the post's own
 * author, which an `author-only` board's reply policy turns on.
 *
 * `isCommentsLocked` stays false here deliberately. The lock is surfaced by
 * its own UI affordance (the "comments are locked" notice), not by collapsing
 * the viewer's permission state — the write path re-checks it via
 * `canCreateComment` with the real flag.
 *
 * Callers pass a post they have ALREADY proved viewable for this actor
 * (assertPostViewable / getPublicPostDetail); the inner view check is then a
 * no-op and the decision reflects the comment gates specifically.
 */
export function canCommentOnPost(
  actor: Actor,
  post: PostShape,
  access: BoardAccess,
  allowAnonymous: boolean
): boolean {
  const allowed = canCreateComment(
    actor,
    { ...post, isCommentsLocked: false },
    { access: normalizeBoardAccess(access) },
    undefined
  ).allowed
  return isAnonCeilinged(actor) ? allowed && allowAnonymous : allowed
}
