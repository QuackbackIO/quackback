import { describe, expect, it } from 'vitest'
import { isSsoTestCallbackPath } from '../sso-test-keys'

describe('isSsoTestCallbackPath', () => {
  it('intercepts the Better Auth callback and the pre-1.7 alias', () => {
    expect(isSsoTestCallbackPath('/api/auth/callback/oidc_abc')).toBe(true)
    expect(isSsoTestCallbackPath('/api/auth/callback/google')).toBe(true)
    expect(isSsoTestCallbackPath('/api/auth/oauth2/callback/sso')).toBe(true)
  })

  it('ignores other auth routes', () => {
    expect(isSsoTestCallbackPath('/api/auth/sign-in/social')).toBe(false)
    expect(isSsoTestCallbackPath('/oauth/slack/callback')).toBe(false)
  })
})
