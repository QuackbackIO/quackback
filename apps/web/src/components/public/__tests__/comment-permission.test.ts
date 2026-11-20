import { describe, it, expect } from 'vitest'
import { resolveCommentingState, resolveSectionCommenting } from '../comment-permission'

/**
 * The portal comment CTA must follow the SERVER-computed `canComment`, which
 * already composes the board's per-action `access.comment` tier with the
 * workspace anonymous master switch. The component must NOT re-open the form
 * with the workspace-wide flag on top of a board that requires sign-in
 * (the Codex P2 finding): doing so advertised an action the board rejects.
 */
describe('resolveCommentingState', () => {
  const anonSession = { user: { principalType: 'anonymous' } }
  const userSession = { user: { principalType: 'user' } }

  it('hides the form when the board denies commenting, even for a logged-in user', () => {
    const state = resolveCommentingState(false, userSession)
    expect(state.allowCommenting).toBe(false)
  })

  // noAccess distinguishes authz (signed-in but denied) from authn (sign in to
  // comment). It drives the "You don't have access to comment on this board"
  // message instead of the sign-in prompt.
  it('flags noAccess when a signed-in real user is denied (authorization, not auth)', () => {
    expect(resolveCommentingState(false, userSession).noAccess).toBe(true)
  })

  it('does not flag noAccess for a denied anonymous/no-session viewer (that is sign-in)', () => {
    expect(resolveCommentingState(false, null).noAccess).toBe(false)
    expect(resolveCommentingState(false, anonSession).noAccess).toBe(false)
  })

  it('does not flag noAccess when commenting is allowed', () => {
    expect(resolveCommentingState(true, userSession).noAccess).toBe(false)
    expect(resolveCommentingState(true, null).noAccess).toBe(false)
  })

  it('hides the form for an anonymous visitor when the board requires sign-in', () => {
    // serverAllowCommenting=false means the board tier (or workspace switch)
    // already denied this viewer — the workspace flag must not re-open it.
    const state = resolveCommentingState(false, null)
    expect(state.allowCommenting).toBe(false)
    expect(state.needsAnonSession).toBe(false)
  })

  it('shows the form when the server allows the logged-in user to comment', () => {
    const state = resolveCommentingState(true, userSession)
    expect(state.allowCommenting).toBe(true)
    expect(state.surfaceSessionUser).toBe(true)
    // A real user session needs no lazy anonymous session.
    expect(state.needsAnonSession).toBe(false)
  })

  it('allows a no-session visitor to comment anonymously when the server permits it', () => {
    const state = resolveCommentingState(true, null)
    expect(state.allowCommenting).toBe(true)
    // No session yet — the form is shown and a session is created lazily on submit.
    expect(state.needsAnonSession).toBe(true)
  })

  it('surfaces an existing anonymous session as the author only when allowed', () => {
    expect(resolveCommentingState(true, anonSession).surfaceSessionUser).toBe(true)
    // Denied board: do not surface the anon session user as a would-be author.
    expect(resolveCommentingState(false, anonSession).surfaceSessionUser).toBe(false)
  })

  it('needs a lazy anon session for an existing anonymous session too (idempotent ensure)', () => {
    // ensureAnonSession is idempotent, so gating on "allowed and not a real
    // user" is safe and keeps the existing anon-comment flow working.
    expect(resolveCommentingState(true, anonSession).needsAnonSession).toBe(true)
  })
})

describe('resolveSectionCommenting', () => {
  const base = {
    disableCommenting: false,
    isAdminView: false,
    serverCanComment: true as boolean | undefined,
    boardReadOnly: false,
  }

  it('follows the server in the portal', () => {
    expect(resolveSectionCommenting(base)).toBe(true)
    expect(resolveSectionCommenting({ ...base, serverCanComment: false })).toBe(false)
  })

  it('always allows the admin view on an open board', () => {
    expect(
      resolveSectionCommenting({ ...base, isAdminView: true, serverCanComment: undefined })
    ).toBe(true)
  })

  it('closes the admin view too on a read-only board, team notes included', () => {
    expect(resolveSectionCommenting({ ...base, isAdminView: true, boardReadOnly: true })).toBe(
      false
    )
  })

  it('a disabled section stays closed', () => {
    expect(resolveSectionCommenting({ ...base, isAdminView: true, disableCommenting: true })).toBe(
      false
    )
  })
})
