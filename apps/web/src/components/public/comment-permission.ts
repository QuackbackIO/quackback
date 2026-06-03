/**
 * Client-side resolution of the portal comment CTA state.
 *
 * The server (`getCommentsSectionDataFn`) is the source of truth for
 * `canComment`: it composes the board's per-action `access.comment` tier with
 * the workspace anonymous master switch for the current viewer. The component
 * must follow that decision verbatim — it must NOT re-open the form with the
 * workspace-wide `allowAnonymous` flag on top of a board whose comment tier
 * requires sign-in, which would advertise an action the server rejects.
 */

interface SessionLike {
  user?: { principalType?: string } | null
}

export interface CommentingState {
  /** Whether to show the comment form / reply controls at all. */
  allowCommenting: boolean
  /** Whether the current session user should be surfaced as the author. */
  surfaceSessionUser: boolean
  /**
   * Whether an anonymous session must be created lazily before the first
   * comment (no real user session yet, but commenting is allowed). Safe to
   * set for an existing anonymous session — `ensureAnonSession` is idempotent.
   */
  needsAnonSession: boolean
  /**
   * Whether a signed-in (real-user) viewer is denied commenting by the board's
   * tier — an authorization failure, not authentication. Drives the "You don't
   * have access to comment on this board" message instead of a sign-in prompt.
   */
  noAccess: boolean
}

export function resolveCommentingState(
  serverAllowCommenting: boolean,
  session: SessionLike | null | undefined
): CommentingState {
  const sessionUser = session?.user ?? null
  const isAnonymous = sessionUser?.principalType === 'anonymous'
  const isRealUser = !!sessionUser && !isAnonymous

  return {
    allowCommenting: serverAllowCommenting,
    surfaceSessionUser: !!sessionUser && (isRealUser || serverAllowCommenting),
    needsAnonSession: serverAllowCommenting && !isRealUser,
    noAccess: !serverAllowCommenting && isRealUser,
  }
}
