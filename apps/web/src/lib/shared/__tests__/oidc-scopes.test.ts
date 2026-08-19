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
    // Keeps "null means defaults" intact even though the editor prefills the
    // effective value, so an untouched provider is not rewritten to a literal.
    expect(normalizeScopesInput(['openid', 'email', 'profile'])).toBeNull()
    expect(normalizeScopesInput(['profile', 'openid', 'email'])).toBeNull()
  })

  it('persists null for an empty set rather than a blank string', () => {
    // A stored blank used to mean "defaults" to registration and "no scopes"
    // to the connection test. Never write one.
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
    // A strict subset is a real choice, not the default set.
    expect(normalizeScopesInput(['openid', 'email'])).toBe('openid email')
  })
})

describe('REQUIRED_OIDC_SCOPE', () => {
  it('is openid, the scope that makes this an OIDC request at all', () => {
    // Without it the IdP owes no ID token and the userinfo endpoint has no
    // openid-scoped token to accept, so the editor must not let it be removed.
    expect(REQUIRED_OIDC_SCOPE).toBe('openid')
    expect(DEFAULT_OIDC_SCOPES).toContain(REQUIRED_OIDC_SCOPE)
  })
})

describe('unsupportedScopes', () => {
  it('reports nothing when every scope is advertised', () => {
    expect(unsupportedScopes(['openid', 'email'], ['openid', 'email', 'profile'])).toEqual([])
  })

  it('reports the scopes the IdP does not advertise', () => {
    // The reported failure exactly: an IdP advertising only public + openid,
    // asked for openid email profile.
    expect(unsupportedScopes(['openid', 'email', 'profile'], ['public', 'openid'])).toEqual([
      'email',
      'profile',
    ])
  })

  it('reports nothing when the IdP advertises no list at all', () => {
    // scopes_supported is RECOMMENDED, not required. Absent means unknown, and
    // flagging every scope on a provider that simply omits it would be noise.
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
    // Dropping openid would stop the request being an OIDC request at all, so
    // the one-click fix must never produce that.
    expect(supportedSubset(['openid', 'email'], ['email'])).toEqual(['openid', 'email'])
  })

  it('returns the input unchanged when nothing is advertised', () => {
    expect(supportedSubset(['openid', 'email'], null)).toEqual(['openid', 'email'])
  })
})
