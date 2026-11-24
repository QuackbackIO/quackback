/**
 * Moderation approval policy — UI mapping helpers.
 *
 * The stored policy is a single enum (`requireApproval`), but it is really
 * two independent questions: do anonymous submissions wait for review, and
 * do signed-in submissions wait for review. `none` is neither, `all` is
 * both. These helpers convert between the enum and the two-toggle UI so the
 * data model and server stay unchanged.
 */

/** The four workspace approval levels. */
export type RequireApprovalLevel = 'none' | 'anonymous' | 'authenticated' | 'all'

export interface ApprovalToggles {
  /** Hold posts from anonymous (no-account) submitters for review. */
  anonymous: boolean
  /** Hold posts from signed-in portal users for review. */
  authenticated: boolean
}

/** Enum -> the two-toggle UI state. */
export function requireApprovalToToggles(level: RequireApprovalLevel): ApprovalToggles {
  return {
    anonymous: level === 'anonymous' || level === 'all',
    authenticated: level === 'authenticated' || level === 'all',
  }
}

/** The two-toggle UI state -> enum. */
export function togglesToRequireApproval(toggles: ApprovalToggles): RequireApprovalLevel {
  if (toggles.anonymous && toggles.authenticated) return 'all'
  if (toggles.anonymous) return 'anonymous'
  if (toggles.authenticated) return 'authenticated'
  return 'none'
}

/** The three per-board moderation axes, matching BoardAccess.moderation. */
export type ModerationAxis = 'anonPosts' | 'signedPosts' | 'comments'

/**
 * Resolve a workspace `requireApproval` level to whether a given moderation
 * axis should HOLD submissions for review, for the `'inherit'` case.
 *
 *   none          -> all axes off
 *   anonymous     -> anonPosts on; signedPosts/comments off
 *   authenticated -> signedPosts on; anonPosts/comments off
 *   all           -> all axes on
 *
 * Comments inherit-resolve to `on` only at `'all'`, since today's workspace
 * setting doesn't separate post- from comment-moderation.
 *
 * Single source of truth: both the server policy (canCreatePost/Comment) and
 * the board Moderation UI pill import this — do not re-implement it.
 */
export function resolveWorkspaceModeration(
  axis: ModerationAxis,
  level: RequireApprovalLevel | undefined
): 'on' | 'off' {
  const ws = level ?? 'none'
  if (axis === 'comments') return ws === 'all' ? 'on' : 'off'
  if (axis === 'anonPosts') return ws === 'all' || ws === 'anonymous' ? 'on' : 'off'
  return ws === 'all' || ws === 'authenticated' ? 'on' : 'off'
}

/**
 * How many days after an item was submitted its author still gets an email
 * about the team's decision on it. Clearing a queue that built up for months
 * would otherwise email every author at once, spammers included, about things
 * they have long forgotten. An age rule rather than a release date, so a
 * self-hosted install that upgrades later skips its own old backlog too. The
 * in-app notification still goes: it is quiet, and only seen by someone who
 * comes back.
 */
export const MODERATION_DECISION_EMAIL_MAX_AGE_DAYS = 14
