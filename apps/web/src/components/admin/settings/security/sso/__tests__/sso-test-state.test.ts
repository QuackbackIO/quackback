// @vitest-environment happy-dom
/**
 * Pure state machine for the SSO test sign-in modal. Phases:
 *   closed -> prompt -> testing -> result, with `close` resetting to
 *   closed from anywhere. The `open` action carries the optional gate
 *   reason (why the modal was opened — e.g. "Verify sign-in before
 *   enabling SSO"); a bare open (the standalone Test button) has none.
 */
import { describe, it, expect } from 'vitest'
import { ssoTestReducer, initialSsoTestState, type SsoTestState } from '../sso-test-state'

const okResult = {
  ok: true as const,
  steps: [],
  claims: { iss: 'https://idp', sub: 'u1', aud: 'cid', email: 'a@b.com' },
  tokenInfo: { idTokenAlg: 'RS256', hasAccessToken: true, hasRefreshToken: false },
}

/** A `result`-phase state with a successful diagnostic on record. */
const resultState: SsoTestState = {
  phase: 'result',
  reason: 'x',
  result: okResult,
  error: null,
  identityMatched: true,
  appliedMessage: null,
}

describe('ssoTestReducer', () => {
  it('starts closed with everything cleared', () => {
    expect(initialSsoTestState).toEqual({
      phase: 'closed',
      reason: null,
      result: null,
      error: null,
      identityMatched: undefined,
      appliedMessage: null,
    })
  })

  it('open -> prompt, carrying the gate reason', () => {
    const next = ssoTestReducer(initialSsoTestState, {
      type: 'open',
      reason: 'Verify sign-in before enabling SSO.',
    })
    expect(next.phase).toBe('prompt')
    expect(next.reason).toBe('Verify sign-in before enabling SSO.')
  })

  it('open with no reason -> prompt, reason null (standalone Test button)', () => {
    const next = ssoTestReducer(initialSsoTestState, { type: 'open' })
    expect(next.phase).toBe('prompt')
    expect(next.reason).toBeNull()
  })

  it('start -> testing, clearing any stale result / error / appliedMessage', () => {
    const dirty: SsoTestState = {
      ...resultState,
      phase: 'prompt',
      error: 'old error',
      identityMatched: false,
      appliedMessage: 'stale applied message',
    }
    const next = ssoTestReducer(dirty, { type: 'start' })
    expect(next.phase).toBe('testing')
    expect(next.result).toBeNull()
    expect(next.error).toBeNull()
    expect(next.identityMatched).toBeUndefined()
    expect(next.appliedMessage).toBeNull()
    // reason persists across the start so the result view can still
    // show "...before enabling SSO" context.
    expect(next.reason).toBe('x')
  })

  it('resolved -> result, capturing the diagnostic + identity match', () => {
    const testing: SsoTestState = { ...initialSsoTestState, phase: 'testing', reason: 'x' }
    const next = ssoTestReducer(testing, {
      type: 'resolved',
      result: okResult,
      identityMatched: true,
    })
    expect(next.phase).toBe('result')
    expect(next.result).toEqual(okResult)
    expect(next.identityMatched).toBe(true)
    expect(next.appliedMessage).toBeNull()
  })

  it('failed -> result phase with the error message, result null', () => {
    const testing: SsoTestState = { ...initialSsoTestState, phase: 'testing' }
    const next = ssoTestReducer(testing, { type: 'failed', error: 'popup blocked' })
    expect(next.phase).toBe('result')
    expect(next.error).toBe('popup blocked')
    expect(next.result).toBeNull()
  })

  it('applied -> stays on the result view, sets the completion message', () => {
    const next = ssoTestReducer(resultState, {
      type: 'applied',
      message: 'Single sign-on is now enabled.',
    })
    // The modal stays open showing the diagnostics — the gate trigger
    // wants the admin to see the result, plus a confirmation banner.
    expect(next.phase).toBe('result')
    expect(next.result).toEqual(okResult)
    expect(next.appliedMessage).toBe('Single sign-on is now enabled.')
  })

  it('close -> back to the initial state from any phase', () => {
    const mid: SsoTestState = { ...resultState, appliedMessage: 'enabled' }
    expect(ssoTestReducer(mid, { type: 'close' })).toEqual(initialSsoTestState)
  })

  it('open from a result phase resets the stale result/error/appliedMessage first', () => {
    const stale: SsoTestState = { ...resultState, reason: 'old', appliedMessage: 'enabled' }
    const next = ssoTestReducer(stale, { type: 'open', reason: 'new' })
    expect(next.phase).toBe('prompt')
    expect(next.reason).toBe('new')
    expect(next.result).toBeNull()
    expect(next.identityMatched).toBeUndefined()
    expect(next.appliedMessage).toBeNull()
  })
})
