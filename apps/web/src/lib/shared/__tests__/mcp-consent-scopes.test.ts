import { describe, expect, it } from 'vitest'
import {
  ACCESS_DOMAINS,
  API_KEY_SCOPES,
  MCP_AS_SCOPES,
  MCP_FIRST_CONNECT_SCOPES,
  domainAccessLevels,
} from '@/lib/shared/api-key-scopes'
import {
  CLIENT_REQUESTED_SCOPE_PARAM,
  clientRequestedFromConsentSearch,
  consentGrantScope,
  defaultSelectedScopes,
  expandAuthorizeScopes,
  hasCapabilityGrant,
  parseScopeList,
  rewriteMcpAuthorizeRequest,
} from '../mcp-consent-scopes'

describe('ACCESS_DOMAINS', () => {
  it('lists every capability domain, including write-only changelog', () => {
    expect(ACCESS_DOMAINS.map((d) => d.label)).toEqual([
      'Feedback',
      'Changelog',
      'Help Center',
      'Conversations',
    ])
    expect(ACCESS_DOMAINS.find((d) => d.domain === 'changelog')).toEqual(
      expect.objectContaining({
        readScope: null,
        writeScope: 'write:changelog',
        kind: 'write_only',
      })
    )
  })
})

describe('defaultSelectedScopes', () => {
  it('prefills the MCP first-connect reads and leaves writes off', () => {
    const selected = defaultSelectedScopes([...MCP_FIRST_CONNECT_SCOPES])
    expect(selected).toEqual([...MCP_FIRST_CONNECT_SCOPES])
    expect(selected).not.toContain('write:feedback')
    expect(selected).not.toContain('offline_access')
    expect(domainAccessLevels(selected)).toEqual({
      feedback: 'read',
      changelog: 'off',
      article: 'read',
      chat: 'read',
    })
  })

  it('turns on a step-up write the client asked for without forcing the others', () => {
    const selected = defaultSelectedScopes([
      ...MCP_FIRST_CONNECT_SCOPES,
      'write:feedback',
      'offline_access',
    ])
    expect(selected).toContain('write:feedback')
    expect(selected).toContain('offline_access')
    expect(selected).not.toContain('write:chat')
    expect(domainAccessLevels(selected).feedback).toBe('read_write')
  })
})

describe('consentGrantScope', () => {
  it('always includes identity and orders the grant like the AS catalogue', () => {
    expect(consentGrantScope(['write:feedback', 'read:feedback'])).toBe(
      'openid profile email read:feedback write:feedback'
    )
  })

  it('expands a write-only grant to include the sibling read', () => {
    expect(consentGrantScope(['write:feedback'])).toBe(
      'openid profile email read:feedback write:feedback'
    )
  })
})

describe('expandAuthorizeScopes', () => {
  it('is the full AS allow-list so consent can grant writes the client omitted', () => {
    expect(expandAuthorizeScopes().split(' ')).toEqual([...MCP_AS_SCOPES])
  })
})

describe('rewriteMcpAuthorizeRequest', () => {
  it('expands authorize scope and preserves what the client sent', () => {
    const request = rewriteMcpAuthorizeRequest(
      new Request(
        'http://localhost:3008/api/auth/oauth2/authorize?client_id=c&scope=read:feedback+read:article+read:chat'
      )
    )
    const url = new URL(request.url)
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([...MCP_AS_SCOPES])
    expect(parseScopeList(url.searchParams.get(CLIENT_REQUESTED_SCOPE_PARAM))).toEqual([
      ...MCP_FIRST_CONNECT_SCOPES,
    ])
  })

  it('does not rewrite a request whose scope is already the catalogue', () => {
    const once = rewriteMcpAuthorizeRequest(
      new Request('http://localhost:3008/api/auth/oauth2/authorize?scope=read:feedback')
    )
    const twice = rewriteMcpAuthorizeRequest(once)
    expect(twice.url).toBe(once.url)
  })

  it('ignores a client-supplied qb_requested_scope when scope is not the catalogue', () => {
    const request = rewriteMcpAuthorizeRequest(
      new Request(
        'http://localhost:3008/api/auth/oauth2/authorize?scope=read:feedback&qb_requested_scope=write:chat+write:feedback'
      )
    )
    const url = new URL(request.url)
    expect(parseScopeList(url.searchParams.get(CLIENT_REQUESTED_SCOPE_PARAM))).toEqual([
      'read:feedback',
    ])
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([...MCP_AS_SCOPES])
  })
})

describe('clientRequestedFromConsentSearch', () => {
  it('prefers the preserved client request over the expanded authorize scope', () => {
    expect(
      clientRequestedFromConsentSearch({
        requested: 'read:feedback read:article read:chat',
        scope: expandAuthorizeScopes(),
      })
    ).toEqual([...MCP_FIRST_CONNECT_SCOPES])
  })

  it('does not treat an expanded scope= as the client request', () => {
    expect(clientRequestedFromConsentSearch({ scope: expandAuthorizeScopes() })).toEqual([
      ...MCP_FIRST_CONNECT_SCOPES,
    ])
  })
})

describe('hasCapabilityGrant', () => {
  it('requires at least one API-key scope', () => {
    expect(hasCapabilityGrant(['offline_access'])).toBe(false)
    expect(hasCapabilityGrant(['read:feedback'])).toBe(true)
    expect(hasCapabilityGrant(API_KEY_SCOPES)).toBe(true)
  })
})
