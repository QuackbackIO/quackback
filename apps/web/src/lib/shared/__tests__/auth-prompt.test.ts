import { describe, it, expect } from 'vitest'
import { parseAuthPromptSearch, buildSigninRedirect } from '../auth-prompt'

describe('parseAuthPromptSearch', () => {
  it('maps auth=signin to login mode and keeps a safe callbackUrl', () => {
    expect(parseAuthPromptSearch({ auth: 'signin', callbackUrl: '/admin' })).toEqual({
      mode: 'login',
      callbackUrl: '/admin',
    })
  })
  it('maps auth=signup to signup mode', () => {
    expect(parseAuthPromptSearch({ auth: 'signup' })).toEqual({ mode: 'signup' })
  })
  it('ignores an unrecognised auth value', () => {
    expect(parseAuthPromptSearch({ auth: 'nope' })).toEqual({})
  })
  it('drops an unsafe (absolute/cross-origin) callbackUrl', () => {
    expect(parseAuthPromptSearch({ auth: 'signin', callbackUrl: 'https://evil.test' })).toEqual({
      mode: 'login',
    })
  })
})

describe('buildSigninRedirect', () => {
  it('builds a portal-root redirect carrying callbackUrl', () => {
    expect(buildSigninRedirect('/admin')).toEqual({
      to: '/',
      search: { auth: 'signin', callbackUrl: '/admin' },
    })
  })
  it('includes error + signup mode when provided', () => {
    expect(buildSigninRedirect('/admin', { mode: 'signup', error: 'not_team_member' })).toEqual({
      to: '/',
      search: { auth: 'signup', callbackUrl: '/admin', error: 'not_team_member' },
    })
  })
})
