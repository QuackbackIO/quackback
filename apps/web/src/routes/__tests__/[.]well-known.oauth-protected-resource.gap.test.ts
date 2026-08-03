import { describe, it, expect, vi } from 'vitest'

// Mock createFileRoute so Route exposes the handler config under .options.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (cfg: unknown) => ({ options: cfg }),
}))

// Source dynamically imports these inside the handler.
vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://example.test' },
}))
vi.mock('@/lib/server/mcp/types', () => ({
  MCP_SCOPES: ['mcp:read', 'mcp:write'],
}))

import { Route } from '../[.]well-known.oauth-protected-resource'

function getGET() {
  return (
    Route as unknown as {
      options: { server: { handlers: { GET: (a: { request: Request }) => Promise<Response> } } }
    }
  ).options.server.handlers.GET
}

describe('GET /.well-known/oauth-protected-resource', () => {
  it('returns RFC 9728 metadata derived from config.baseUrl', async () => {
    const res = await getGET()({
      request: new Request('https://example.test/.well-known/oauth-protected-resource'),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/json')
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600')

    const body = (await res.json()) as {
      resource: string
      authorization_servers: string[]
      bearer_methods_supported: string[]
      scopes_supported: string[]
    }
    expect(body.resource).toBe('https://example.test/api/mcp')
    expect(body.authorization_servers).toEqual(['https://example.test'])
    expect(body.bearer_methods_supported).toEqual(['header'])
    expect(body.scopes_supported).toEqual([
      'openid',
      'profile',
      'email',
      'offline_access',
      'mcp:read',
      'mcp:write',
    ])
  })
})
