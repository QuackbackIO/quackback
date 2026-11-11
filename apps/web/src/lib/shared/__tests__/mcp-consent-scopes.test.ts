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
  consentPreset,
  consentPresetLevels,
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
      'Settings',
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
  const full = {
    feedback: 'read_write',
    changelog: 'write',
    article: 'read_write',
    chat: 'read_write',
    settings: 'read_write',
  }

  it('defaults a connect that asked for every capability to full access', () => {
    const selected = defaultSelectedScopes([...API_KEY_SCOPES, 'offline_access'])
    expect(domainAccessLevels(selected)).toEqual(full)
    expect(selected).toContain('offline_access')
  })

  it('defaults a reads-only request to full access too', () => {
    // A client that cached the older reads-only challenge, or reads RFC 9728
    // `scopes_supported`, still gets a connection that can write.
    const selected = defaultSelectedScopes([...MCP_FIRST_CONNECT_SCOPES])
    expect(domainAccessLevels(selected)).toEqual(full)
    expect(selected).not.toContain('offline_access')
  })

  it('defaults a request that names no capability to full access', () => {
    expect(domainAccessLevels(defaultSelectedScopes(['openid']))).toEqual(full)
  })

  it('does not widen a request for only some reads to writes', () => {
    // A client that asks for one area is asking for less on purpose.
    const selected = defaultSelectedScopes(['openid', 'read:feedback'])
    expect(selected.filter((scope) => scope.startsWith('write:'))).toEqual([])
    expect(consentPreset(domainAccessLevels(selected))).toBe('read')
  })

  it('keeps a request for some writes to the reads plus those writes', () => {
    const selected = defaultSelectedScopes([
      ...MCP_FIRST_CONNECT_SCOPES,
      'write:feedback',
      'offline_access',
    ])
    expect(selected).toContain('write:feedback')
    expect(selected).toContain('offline_access')
    expect(selected).not.toContain('write:chat')
    expect(domainAccessLevels(selected)).toEqual({
      feedback: 'read_write',
      changelog: 'off',
      article: 'read',
      chat: 'read',
      settings: 'read',
    })
  })
})

describe('consent presets', () => {
  it('full access is every capability and read only is every read', () => {
    expect(consentPresetLevels('full')).toEqual(domainAccessLevels(API_KEY_SCOPES))
    expect(consentPresetLevels('read')).toEqual(domainAccessLevels(MCP_FIRST_CONNECT_SCOPES))
  })

  it('names the choice a selection amounts to', () => {
    expect(consentPreset(consentPresetLevels('full'))).toBe('full')
    expect(consentPreset(consentPresetLevels('read'))).toBe('read')
    expect(consentPreset({ ...consentPresetLevels('full'), settings: 'read' })).toBe('custom')
    expect(consentPreset({ ...consentPresetLevels('read'), changelog: 'write' })).toBe('custom')
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
      'read:feedback',
      'read:article',
      'read:chat',
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
    ).toEqual(['read:feedback', 'read:article', 'read:chat'])
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
