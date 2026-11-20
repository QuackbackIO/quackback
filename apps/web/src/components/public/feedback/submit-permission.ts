/**
 * Client-side resolution of the portal submit CTA state for the selected board.
 *
 * `boardCanSubmit` is the SERVER-computed per-board capability
 * (boardCapabilitiesForActor): it composes the board's access.submit tier with
 * the workspace anonymous master switch for the current viewer. The header
 * follows it verbatim — it must NOT re-open the form from the workspace flag on
 * a board whose submit tier requires sign-in, which would advertise an action
 * the server rejects (Codex PR #191).
 */

interface SessionLike {
  user?: { principalType?: string } | null
}

export interface SubmitState {
  /** Whether the submit button is enabled for the selected board. */
  canSubmit: boolean
  /**
   * Whether the viewer would post anonymously (submit allowed, but no real
   * user session). Drives the "Posting anonymously" label and the lazy
   * anonymous-session creation on submit.
   */
  canPostAnonymously: boolean
  /**
   * Whether a signed-in (real-user) viewer is denied submission by the board's
   * tier — an authorization failure, not authentication. Drives the "You don't
   * have access to post on this board" message instead of a sign-in prompt.
   */
  noAccess: boolean
}

export function resolveSubmitState(
  boardCanSubmit: boolean,
  session: SessionLike | null | undefined
): SubmitState {
  const sessionUser = session?.user ?? null
  const isRealUser = !!sessionUser && sessionUser.principalType !== 'anonymous'
  return {
    canSubmit: boardCanSubmit,
    canPostAnonymously: boardCanSubmit && !isRealUser,
    noAccess: !boardCanSubmit && isRealUser,
  }
}

interface ComposerBoard {
  id: string
}

export interface ComposerPlan<B extends ComposerBoard> {
  /** The boards the composer may post to: read-only boards are left out. */
  boards: B[]
  /** Whether the composer stands down for the note (a read-only board, or nothing to post to). */
  readOnly: boolean
}

/**
 * What the portal composer does around read-only boards. On a board page
 * (`lockedBoardId`) it stands down when that board is read-only; on the whole
 * feed it stands down only when every board is.
 */
export function planComposer<B extends ComposerBoard>(
  boards: B[],
  permissions: Record<string, { readOnly?: boolean }> | undefined,
  lockedBoardId: string | undefined
): ComposerPlan<B> {
  const open = boards.filter((board) => !permissions?.[board.id]?.readOnly)
  const locked = lockedBoardId ? permissions?.[lockedBoardId] : undefined
  const readOnly = (boards.length > 0 && open.length === 0) || !!locked?.readOnly
  return { boards: open, readOnly }
}
