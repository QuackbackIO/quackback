/**
 * @vitest-environment happy-dom
 *
 * Tests for the post-2FA callbackURL plumbing.
 *
 * Better-Auth's twoFactor plugin redirect (in
 * `node_modules/.bun/better-auth@1.6.5/.../two-factor/client.mjs`)
 * navigates to a hard-coded `twoFactorPage` URL with NO query-string,
 * which loses the original `callbackURL` request field. We work around
 * that by stashing the desired destination in sessionStorage right
 * before `signIn.email` is called; the twoFactorClient redirect handler
 * reads the stash and forwards as `?callbackURL=...`; the
 * `/auth/two-factor` route then consumes it.
 *
 * The helpers under test:
 *  - `resolveTwoFactorDest` — pure resolver covering both `callbackURL`
 *    (Better-Auth convention) and the legacy `callbackUrl`, with the
 *    `/`-prefix safety check.
 *  - `stashTwoFactorCallbackUrl` / `clearTwoFactorCallbackUrl` — the
 *    sessionStorage shim.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import {
  resolveTwoFactorDest,
  stashTwoFactorCallbackUrl,
  clearTwoFactorCallbackUrl,
  TWO_FACTOR_CALLBACK_STORAGE_KEY,
} from '../client'

describe('resolveTwoFactorDest', () => {
  it('falls back to `/` for undefined search', () => {
    expect(resolveTwoFactorDest(undefined)).toBe('/')
  })

  it('falls back to `/` when no candidate is set', () => {
    expect(resolveTwoFactorDest({})).toBe('/')
  })

  it('honours `callbackURL` (Better-Auth uppercase convention)', () => {
    expect(resolveTwoFactorDest({ callbackURL: '/admin/inbox' })).toBe('/admin/inbox')
  })

  it('honours `callbackUrl` (legacy lowercase) as a fallback', () => {
    expect(resolveTwoFactorDest({ callbackUrl: '/portal/boards' })).toBe('/portal/boards')
  })

  it('prefers `callbackURL` over `callbackUrl` when both are set', () => {
    expect(resolveTwoFactorDest({ callbackURL: '/new', callbackUrl: '/legacy' })).toBe('/new')
  })

  it('rejects absolute URLs (same-origin safety net)', () => {
    expect(resolveTwoFactorDest({ callbackURL: 'https://evil.com/x' })).toBe('/')
    expect(resolveTwoFactorDest({ callbackUrl: 'http://evil.com/x' })).toBe('/')
    expect(resolveTwoFactorDest({ callbackURL: '//evil.com/x' })).toBe('/')
  })

  it('rejects javascript: URIs', () => {
    expect(resolveTwoFactorDest({ callbackURL: 'javascript:alert(1)' })).toBe('/')
  })

  it('rejects empty strings', () => {
    expect(resolveTwoFactorDest({ callbackURL: '', callbackUrl: '' })).toBe('/')
  })

  it('falls through to the second candidate when first is non-`/`', () => {
    expect(resolveTwoFactorDest({ callbackURL: 'https://evil.com/x', callbackUrl: '/safe' })).toBe(
      '/safe'
    )
  })
})

describe('stashTwoFactorCallbackUrl + clearTwoFactorCallbackUrl', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('stashes a `/`-prefixed URL', () => {
    stashTwoFactorCallbackUrl('/admin/settings')
    expect(window.sessionStorage.getItem(TWO_FACTOR_CALLBACK_STORAGE_KEY)).toBe('/admin/settings')
  })

  it('clears a previous stash when called with undefined', () => {
    window.sessionStorage.setItem(TWO_FACTOR_CALLBACK_STORAGE_KEY, '/old')
    stashTwoFactorCallbackUrl(undefined)
    expect(window.sessionStorage.getItem(TWO_FACTOR_CALLBACK_STORAGE_KEY)).toBeNull()
  })

  it('clears a previous stash when called with a non-`/`-prefixed URL', () => {
    window.sessionStorage.setItem(TWO_FACTOR_CALLBACK_STORAGE_KEY, '/old')
    stashTwoFactorCallbackUrl('https://evil.com/x')
    expect(window.sessionStorage.getItem(TWO_FACTOR_CALLBACK_STORAGE_KEY)).toBeNull()
  })

  it('clearTwoFactorCallbackUrl removes the entry', () => {
    window.sessionStorage.setItem(TWO_FACTOR_CALLBACK_STORAGE_KEY, '/x')
    clearTwoFactorCallbackUrl()
    expect(window.sessionStorage.getItem(TWO_FACTOR_CALLBACK_STORAGE_KEY)).toBeNull()
  })
})
