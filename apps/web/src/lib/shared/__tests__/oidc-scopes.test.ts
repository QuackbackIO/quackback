import { describe, it, expect } from 'vitest'
import {
  DEFAULT_OIDC_SCOPES,
  REQUIRED_OIDC_SCOPE,
  effectiveScopes,
  normalizeScopesInput,
  parseScopes,
  supportedSubset,
  unsupportedScopes,
} from '../oidc-scopes'

describe('parseScopes', () => {
  it('splits on whitespace and commas, dropping empties', () => {
    expect(parseScopes('openid  email,profile')).toEqual(['openid', 'email', 'profile'])
    expect(parseScopes('  ')).toEqual([])
    expect(parseScopes(null)).toEqual([])
  })

  it('de-duplicates while preserving first-seen order', () => {
    expect(parseScopes('openid email openid')).toEqual(['openid', 'email'])
  })
})

describe('effectiveScopes', () => {
  it('falls back to the defaults for null, blank, or whitespace-only', () => {
    expect(effectiveScopes({ scopes: null })).toEqual([...DEFAULT_OIDC_SCOPES])
    expect(effectiveScopes({ scopes: '' })).toEqual([...DEFAULT_OIDC_SCOPES])
    expect(effectiveScopes({ scopes: '   ' })).toEqual([...DEFAULT_OIDC_SCOPES])
  })

  it('preserves a custom set', () => {
    expect(effectiveScopes({ scopes: 'openid public' })).toEqual(['openid', 'public'])
  })
})

describe('normalizeScopesInput', () => {
  it('persists null when the set matches the defaults, regardless of order', () => {
    expect(normalizeScopesInput(['openid', 'email', 'profile'])).toBeNull()
    expect(normalizeScopesInput(['profile', 'openid', 'email'])).toBeNull()
  })

  it('persists null for an empty set rather than a blank string', () => {
    expect(normalizeScopesInput([])).toBeNull()
    expect(normalizeScopesInput(['', '  '])).toBeNull()
  })

  it('joins a custom set with single spaces, de-duplicated', () => {
    expect(normalizeScopesInput(['openid', 'public', 'openid'])).toBe('openid public')
  })

  it('trims each token', () => {
    expect(normalizeScopesInput([' openid ', ' public '])).toBe('openid public')
  })

  it('preserves a custom subset of the defaults', () => {
    expect(normalizeScopesInput(['openid', 'email'])).toBe('openid email')
  })
})

describe('REQUIRED_OIDC_SCOPE', () => {
  it('is openid, the scope that makes this an OIDC request at all', () => {
    expect(REQUIRED_OIDC_SCOPE).toBe('openid')
    expect(DEFAULT_OIDC_SCOPES).toContain(REQUIRED_OIDC_SCOPE)
  })
})

describe('unsupportedScopes', () => {
  it('reports nothing when every scope is advertised', () => {
    expect(unsupportedScopes(['openid', 'email'], ['openid', 'email', 'profile'])).toEqual([])
  })

  it('reports the scopes the IdP does not advertise', () => {
    expect(unsupportedScopes(['openid', 'email', 'profile'], ['public', 'openid'])).toEqual([
      'email',
      'profile',
    ])
  })

  it('reports nothing when the IdP advertises no list at all', () => {
    expect(unsupportedScopes(['openid', 'email'], null)).toEqual([])
    expect(unsupportedScopes(['openid', 'email'], [])).toEqual([])
  })

  it('is case-sensitive, as scope values are', () => {
    expect(unsupportedScopes(['openid'], ['OpenID'])).toEqual(['openid'])
  })
})

describe('supportedSubset', () => {
  it('keeps only the advertised scopes, preserving order', () => {
    expect(supportedSubset(['openid', 'email', 'profile'], ['public', 'openid'])).toEqual([
      'openid',
    ])
  })

  it('always keeps the required scope, even if unadvertised', () => {
    expect(supportedSubset(['openid', 'email'], ['email'])).toEqual(['openid', 'email'])
  })

  it('returns the input unchanged when nothing is advertised', () => {
    expect(supportedSubset(['openid', 'email'], null)).toEqual(['openid', 'email'])
  })
})
