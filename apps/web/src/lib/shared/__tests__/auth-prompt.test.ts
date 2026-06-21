import { describe, it, expect } from 'vitest'
import { parseAuthPromptSearch, buildSigninRedirect } from '../auth-prompt'

describe('parseAuthPromptSearch', () => {
  it('maps signin=1 to login mode and keeps a safe callbackUrl', () => {
    expect(parseAuthPromptSearch({ signin: '1', callbackUrl: '/admin' })).toEqual({
      signin: 'login',
      callbackUrl: '/admin',
    })
  })
  it('maps signin=signup to signup mode', () => {
    expect(parseAuthPromptSearch({ signin: 'signup' })).toEqual({ signin: 'signup' })
  })
  it('passes through prompt=login and error', () => {
    expect(parseAuthPromptSearch({ prompt: 'login', error: 'not_team_member' })).toEqual({
      prompt: 'login',
      error: 'not_team_member',
    })
  })
  it('drops an unsafe (absolute/cross-origin) callbackUrl', () => {
    expect(parseAuthPromptSearch({ signin: '1', callbackUrl: 'https://evil.test' })).toEqual({
      signin: 'login',
    })
  })
})

describe('buildSigninRedirect', () => {
  it('builds a portal-root redirect carrying callbackUrl', () => {
    expect(buildSigninRedirect('/admin')).toEqual({ to: '/', search: { signin: '1', callbackUrl: '/admin' } })
  })
  it('includes error + signup mode when provided', () => {
    expect(buildSigninRedirect('/admin', { mode: 'signup', error: 'not_team_member' })).toEqual({
      to: '/',
      search: { signin: 'signup', callbackUrl: '/admin', error: 'not_team_member' },
    })
  })
})
