/**
 * Pins the auth cookie naming.
 *
 * Drifting this back to the stock Better-Auth prefix would reintroduce
 * the cross-app cookie collision documented in `auth-cookie.ts` — both
 * Quackback and any sibling Better-Auth app on the same eTLD+1 would
 * write `__Secure-better-auth.session_token` and the browser would
 * deliver whichever one its parser happened to yield first. Snapshot
 * the resolved names so a future "let's just use defaults" PR fails
 * loudly in CI instead of in a customer's sign-in loop.
 */
import { describe, expect, it } from 'vitest'
import { AUTH_COOKIE_PREFIX, SESSION_TOKEN_COOKIE_NAME } from '../auth-cookie'

describe('auth cookie naming', () => {
  it('uses a Quackback-specific prefix, not the Better-Auth default', () => {
    expect(AUTH_COOKIE_PREFIX).toBe('quackback')
    // Explicit negative — guards against a refactor that points the
    // constant at the upstream default by reflex.
    expect(AUTH_COOKIE_PREFIX).not.toBe('better-auth')
  })

  it('derives the session-token name from the prefix', () => {
    expect(SESSION_TOKEN_COOKIE_NAME).toBe(`${AUTH_COOKIE_PREFIX}.session_token`)
  })

  it('the __Secure- prefixed name composes correctly for production https', () => {
    // Better-Auth appends `__Secure-` to the prefix-included name in
    // production. Asserting the composition here catches drift in
    // either direction (prefix change OR a regression that hard-codes
    // `__Secure-better-auth...`).
    expect(`__Secure-${SESSION_TOKEN_COOKIE_NAME}`).toBe('__Secure-quackback.session_token')
  })
})
