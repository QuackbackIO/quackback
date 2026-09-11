import { describe, it, expect } from 'vitest'
import { MCP_AS_SCOPES, MCP_FIRST_CONNECT_SCOPES } from '@/lib/shared/api-key-scopes'
import {
  BA_DCR_PLACEHOLDER_REDIRECT_URI,
  mcpDcrRedirectUrisToRestore,
  mcpDcrRegistrationBody,
  needsBetterAuth17RedirectRewrite,
} from '../mcp-dcr-scopes'

const CURSOR_REDIRECT = 'cursor://anysphere.cursor-mcp/oauth/callback'

describe('mcpDcrRegistrationBody', () => {
  it('overwrites a read-only DCR scope with the full AS allow-list', () => {
    const body = mcpDcrRegistrationBody({
      client_name: 'Cursor',
      scope: MCP_FIRST_CONNECT_SCOPES.join(' '),
    })
    const scopes = String(body.scope).split(' ')
    expect(scopes).toEqual([...MCP_AS_SCOPES])
    expect(scopes).toContain('offline_access')
    expect(scopes).toContain('write:feedback')
    expect(scopes).toContain('read:feedback')
    expect(body.application_type).toBe('native')
  })

  it('coerces omitted application_type and Cursor custom-scheme redirects for Better Auth 1.7', () => {
    const original = {
      client_name: 'Cursor',
      redirect_uris: [CURSOR_REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
    const body = mcpDcrRegistrationBody(original)
    expect(body.application_type).toBe('native')
    expect(body.redirect_uris).toEqual([BA_DCR_PLACEHOLDER_REDIRECT_URI])
    expect(mcpDcrRedirectUrisToRestore(original)).toEqual([CURSOR_REDIRECT])
  })

  it('coerces an explicit web client that registered a private-use scheme', () => {
    const body = mcpDcrRegistrationBody({
      application_type: 'web',
      redirect_uris: [CURSOR_REDIRECT],
    })
    expect(body.application_type).toBe('native')
    expect(body.redirect_uris).toEqual([BA_DCR_PLACEHOLDER_REDIRECT_URI])
  })

  it('leaves RFC 8252 loopback and authority-free reverse-domain URIs untouched', () => {
    const original = {
      redirect_uris: ['http://127.0.0.1:9/callback', 'com.example.app:/oauth/callback'],
    }
    const body = mcpDcrRegistrationBody(original)
    expect(body.redirect_uris).toEqual(original.redirect_uris)
    expect(mcpDcrRedirectUrisToRestore(original)).toBeNull()
  })

  it('rewrites only the host-bearing custom scheme in a mixed Cursor set', () => {
    const original = {
      redirect_uris: [
        CURSOR_REDIRECT,
        'https://www.cursor.com/agents/mcp/oauth/callback',
        'http://localhost:8787/callback',
      ],
    }
    expect(mcpDcrRegistrationBody(original).redirect_uris).toEqual([
      BA_DCR_PLACEHOLDER_REDIRECT_URI,
      'https://www.cursor.com/agents/mcp/oauth/callback',
      'http://localhost:8787/callback',
    ])
    expect(mcpDcrRedirectUrisToRestore(original)).toEqual(original.redirect_uris)
  })
})

describe('needsBetterAuth17RedirectRewrite', () => {
  it('rewrites Cursor host-bearing cursor:// callbacks', () => {
    expect(needsBetterAuth17RedirectRewrite(CURSOR_REDIRECT)).toBe(true)
  })

  it('does not rewrite reserved schemes so Better Auth still rejects them', () => {
    expect(needsBetterAuth17RedirectRewrite('file:///tmp/callback')).toBe(false)
    expect(needsBetterAuth17RedirectRewrite('javascript:alert(1)')).toBe(false)
  })
})
