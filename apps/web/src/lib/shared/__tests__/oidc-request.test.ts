import { describe, it, expect } from 'vitest'
import {
  DEFAULT_OIDC_PROMPT,
  DEFAULT_TOKEN_AUTH_METHOD,
  PROMPT_CHOICES,
  TOKEN_AUTH_CHOICES,
  authorizeRequestFor,
  normalizePromptInput,
  normalizeTokenAuthInput,
  supportsPrompt,
} from '../oidc-request'

const row = (over: Record<string, unknown> = {}) => ({
  scopes: null,
  prompt: null,
  tokenEndpointAuthMethod: null,
  ...over,
})

describe('authorizeRequestFor', () => {
  it('returns the defaults for an unconfigured provider', () => {
    const req = authorizeRequestFor(row())
    expect(req.scopes).toEqual(['openid', 'email', 'profile'])
    expect(req.prompt).toBe(DEFAULT_OIDC_PROMPT)
    expect(req.tokenAuth).toBe(DEFAULT_TOKEN_AUTH_METHOD)
  })

  it('carries every configured value', () => {
    const req = authorizeRequestFor(
      row({ scopes: 'openid public', prompt: 'login', tokenEndpointAuthMethod: 'basic' })
    )
    expect(req.scopes).toEqual(['openid', 'public'])
    expect(req.prompt).toBe('login')
    expect(req.tokenAuth).toBe('basic')
  })

  it('omits the prompt entirely when configured to send none', () => {
    // Distinct from prompt=none, which DEMANDS no interaction and errors when
    // nobody is signed in. Omitting the parameter just leaves the provider to
    // behave normally.
    const req = authorizeRequestFor(row({ prompt: 'omit' }))
    expect(req.prompt).toBeUndefined()
  })

  it('still sends prompt=none when that is what was asked for', () => {
    expect(authorizeRequestFor(row({ prompt: 'none' })).prompt).toBe('none')
  })

  it('is the single source both paths read, so one row yields one request', () => {
    const provider = row({ scopes: 'openid', prompt: 'consent' })
    expect(authorizeRequestFor(provider)).toEqual(authorizeRequestFor(provider))
  })
})

describe('normalizePromptInput', () => {
  it('stores null for the default so an untouched provider is not rewritten', () => {
    expect(normalizePromptInput(DEFAULT_OIDC_PROMPT)).toBeNull()
  })

  it('stores a non-default choice verbatim', () => {
    expect(normalizePromptInput('select_account')).toBe('select_account')
    expect(normalizePromptInput('omit')).toBe('omit')
  })

  it('rejects anything not a known choice', () => {
    // A free-typed value would reach the IdP unvalidated and fail opaquely.
    expect(normalizePromptInput('nonsense')).toBeNull()
    expect(normalizePromptInput('')).toBeNull()
  })
})

describe('normalizeTokenAuthInput', () => {
  it('stores null for the default', () => {
    expect(normalizeTokenAuthInput(DEFAULT_TOKEN_AUTH_METHOD)).toBeNull()
  })

  it('stores the other method verbatim and rejects the unknown', () => {
    expect(normalizeTokenAuthInput('basic')).toBe('basic')
    expect(normalizeTokenAuthInput('private_key_jwt')).toBeNull()
  })
})

describe('supportsPrompt', () => {
  it('says nothing when the provider advertises no prompt list', () => {
    // prompt_values_supported is optional metadata and almost nobody publishes
    // it, so absent must mean unknown rather than unsupported.
    expect(supportsPrompt('select_account', null)).toBe(true)
    expect(supportsPrompt('select_account', [])).toBe(true)
  })

  it('detects an unadvertised prompt when the list exists', () => {
    expect(supportsPrompt('select_account', ['login', 'consent', 'none'])).toBe(false)
    expect(supportsPrompt('login', ['login', 'consent', 'none'])).toBe(true)
  })

  it('treats omitting the prompt as always supported', () => {
    expect(supportsPrompt(undefined, ['login'])).toBe(true)
  })
})

describe('choice lists', () => {
  it('offers omit and none as separate choices', () => {
    // Collapsing them is the plausible simplification that breaks sign-in.
    const values = PROMPT_CHOICES.map((c) => c.value)
    expect(values).toContain('omit')
    expect(values).toContain('none')
  })

  it('marks the default choice in each list', () => {
    expect(PROMPT_CHOICES.find((c) => c.value === DEFAULT_OIDC_PROMPT)).toBeDefined()
    expect(TOKEN_AUTH_CHOICES.find((c) => c.value === DEFAULT_TOKEN_AUTH_METHOD)).toBeDefined()
  })
})
