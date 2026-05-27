/**
 * Post view + create authorization.
 *
 * Composes with policy.boards — a post is never visible if its board
 * isn't visible, and create is always denied when view is denied.
 */
import { and, eq, or, sql, type SQL } from 'drizzle-orm'
import { posts, type BoardAccess, type ModerationState } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { allowDecision, denyDecision, isTeamActor, type Actor, type Decision } from './types'
import { canViewBoard, boardViewFilter } from './boards'

/** The workspace moderation policy. Boards no longer have a per-board override. */
export type RequireApproval = 'none' | 'anonymous' | 'authenticated' | 'all'

interface PostShape {
  moderationState: ModerationState
  principalId?: PrincipalId | null
}

interface BoardShape {
  access: BoardAccess
}

const isTeam = isTeamActor

export function canViewPost(actor: Actor, post: PostShape, board: BoardShape): Decision {
  const boardDecision = canViewBoard(actor, board)
  if (!boardDecision.allowed) return boardDecision

  if (isTeam(actor)) {
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
  if (isTeam(actor)) {
    return sql`${posts.moderationState} <> 'deleted'`
  }
  const principalIdParam: string | null = actor.principalId ?? null
  const ownPending =
    principalIdParam !== null
      ? and(eq(posts.moderationState, 'pending'), eq(posts.principalId, principalIdParam as never))
      : sql`false`
  return and(boardViewFilter(actor), or(eq(posts.moderationState, 'published'), ownPending))!
}

/**
 * Whether the requesting actor can post a comment on a post.
 *
 * Rules (applied in order):
 * 1. The actor must be able to view the post (board audience + moderation state).
 * 2. If comments are locked, only team members may bypass.
 */
export function canCreateComment(
  actor: Actor,
  post: PostShape & { isCommentsLocked: boolean },
  board: BoardShape
): Decision {
  const view = canViewPost(actor, post, board)
  if (!view.allowed) return view
  if (post.isCommentsLocked && !isTeam(actor)) {
    return denyDecision('Comments are locked on this post')
  }
  return allowDecision()
}

export type CreateDecision =
  | { allowed: true; requiresApproval: boolean }
  | { allowed: false; reason: string }

export function canCreatePost(
  actor: Actor,
  board: BoardShape,
  globalDefault: RequireApproval | undefined
): CreateDecision {
  const view = canViewBoard(actor, board)
  if (!view.allowed) return { allowed: false, reason: view.reason }

  // Team always bypasses the moderation queue.
  if (isTeam(actor)) {
    return { allowed: true, requiresApproval: false }
  }

  // Approval is driven purely by the workspace-wide moderation policy.
  const requireApproval = globalDefault ?? 'none'
  const requires =
    requireApproval === 'all' ||
    (requireApproval === 'anonymous' && actor.principalType !== 'user') ||
    (requireApproval === 'authenticated' && actor.principalType === 'user')

  return { allowed: true, requiresApproval: requires }
}
