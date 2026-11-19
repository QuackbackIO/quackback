import { describe, expect, it } from 'vitest'
import {
  consentClientIdentity,
  describeRedirectUri,
} from '@/lib/server/auth/consent-client-identity'
import { clientIdMetadataHost, isClientIdMetadataUrlAllowed } from '@/lib/server/auth/cimd'

describe('consentClientIdentity', () => {
  it('verifies the client_id host only for a row the cimd discovery owns', () => {
    expect(
      consentClientIdentity({
        clientId: 'https://chatgpt.com/oauth/client.json',
        clientDiscoveryId: 'cimd',
        redirectUris: ['https://chatgpt.com/cb'],
      })
    ).toEqual({
      verified: true,
      host: 'chatgpt.com',
      redirect: { kind: 'web', host: 'chatgpt.com' },
    })
  })

  it('never trusts an https-shaped client_id on a row it does not own', () => {
    expect(
      consentClientIdentity({
        clientId: 'https://chatgpt.com/oauth/client.json',
        clientDiscoveryId: null,
        redirectUris: ['https://attacker.example/cb'],
      })
    ).toEqual({ verified: false, redirect: { kind: 'web', host: 'attacker.example' } })
  })

  it('shows the host in punycode, so a lookalike name cannot hide', () => {
    expect(
      consentClientIdentity({
        clientId: 'https://chаtgpt.com/oauth/client.json', // Cyrillic "а"
        clientDiscoveryId: 'cimd',
        redirectUris: [],
      })
    ).toEqual({ verified: true, host: 'xn--chtgpt-4nf.com', redirect: null })
  })

  it('uses the requested redirect only when the client registered it', () => {
    const row = {
      clientId: 'abc',
      clientDiscoveryId: null,
      redirectUris: ['https://one.example/cb', 'https://two.example/cb'],
    }
    expect(consentClientIdentity(row, 'https://two.example/cb')).toEqual({
      verified: false,
      redirect: { kind: 'web', host: 'two.example' },
    })
    expect(consentClientIdentity(row, 'https://evil.example/cb')).toEqual({
      verified: false,
      redirect: null,
    })
    expect(consentClientIdentity({ ...row, redirectUris: [row.redirectUris[0]!] })).toEqual({
      verified: false,
      redirect: { kind: 'web', host: 'one.example' },
    })
  })
})

describe('loopback redirects with a run-time port (RFC 8252)', () => {
  // Claude Code's real CIMD document registers these and listens on a random port.
  const claudeCode = {
    clientId: 'https://claude.ai/oauth/claude-code-client-metadata',
    clientDiscoveryId: 'cimd',
    redirectUris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
  }

  it('recognises the redirect the client actually used, so the device warning shows', () => {
    expect(consentClientIdentity(claudeCode, 'http://localhost:42422/callback')).toEqual({
      verified: true,
      host: 'claude.ai',
      redirect: { kind: 'device' },
    })
  })

  it('still needs the same host, path and query', () => {
    for (const uri of [
      'http://127.0.0.2:42422/callback',
      'http://localhost:42422/other',
      'http://localhost:42422/callback?x=1',
      'https://localhost:42422/callback',
    ]) {
      expect(consentClientIdentity(claudeCode, uri).redirect, uri).toBeNull()
    }
  })

  it('never relaxes the port of a non-loopback redirect', () => {
    expect(
      consentClientIdentity(
        {
          clientId: 'abc',
          clientDiscoveryId: null,
          redirectUris: ['https://app.example/cb', 'https://b.example/cb'],
        },
        'https://app.example:8443/cb'
      ).redirect
    ).toBeNull()
  })
})

describe('describeRedirectUri', () => {
  it.each([
    ['https://chatgpt.com/connector/oauth', { kind: 'web', host: 'chatgpt.com' }],
    ['http://localhost:33418/callback', { kind: 'device' }],
    ['http://127.0.0.1:9000/cb', { kind: 'device' }],
    ['http://[::1]:9000/cb', { kind: 'device' }],
    ['cursor://anysphere.cursor-mcp/oauth/callback', { kind: 'app', scheme: 'cursor' }],
    ['com.example.app:/oauth', { kind: 'app', scheme: 'com.example.app' }],
    ['not a url', null],
  ])('%s', (uri, expected) => {
    expect(describeRedirectUri(uri)).toEqual(expected)
  })
})

describe('isClientIdMetadataUrlAllowed', () => {
  it.each([
    ['https://chatgpt.com/oauth/client.json', true],
    ['https://claude.ai/oauth/mcp-oauth-client-metadata', true],
    ['https://chatgpt.com/', false],
    ['https://chatgpt.com', false],
    ['http://chatgpt.com/oauth/client.json', false],
    ['https://user:pass@chatgpt.com/oauth/client.json', false],
    ['https://chatgpt.com/oauth/client.json#x', false],
    ['client-abc', false],
  ])('%s → %s', (url, allowed) => {
    expect(isClientIdMetadataUrlAllowed(url)).toBe(allowed)
  })

  it('reads the host of an https client_id only', () => {
    expect(clientIdMetadataHost('https://chatgpt.com/oauth/client.json')).toBe('chatgpt.com')
    expect(clientIdMetadataHost('http://chatgpt.com/x')).toBeNull()
    expect(clientIdMetadataHost('abc')).toBeNull()
  })
})
