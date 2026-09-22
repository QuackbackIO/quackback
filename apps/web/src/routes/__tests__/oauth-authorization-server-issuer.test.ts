// @vitest-environment node
/**
 * The protected-resource document names an authorization server, and MCP
 * clients fetch that server's RFC 8414 metadata at the path-inserted
 * well-known URL, then reject it unless `issuer` equals the advertised value.
 *
 * Asked of a real Better Auth instance (in-memory adapter) rather than a stub,
 * so a change to the library's issuer derivation or to our `basePath` fails
 * here instead of at a client's discovery step.
 */
import { describe, it, expect, vi } from 'vitest'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { jwt } from 'better-auth/plugins'
import { mcp } from '@better-auth/mcp'

const BASE_URL = 'https://feedback.example.com'

const auth = betterAuth({
  baseURL: BASE_URL,
  secret: 'test-secret-not-used-for-anything-real',
  database: memoryAdapter({ oauthResource: [], oauthClient: [], jwks: [] }),
  plugins: [
    jwt(),
    mcp({
      loginPage: '/auth/login',
      consentPage: '/oauth/consent',
      resource: `${BASE_URL}/api/mcp`,
    }),
  ],
})

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (path: string) => (opts: unknown) => ({ path, options: opts }),
}))

vi.mock('@/lib/server/auth/index', () => ({
  getAuth: async () => auth,
}))

import { mcpProtectedResourceMetadata } from '@/lib/server/mcp/protected-resource-metadata'
import { Route as PathInsertedRoute } from '../[.]well-known.oauth-authorization-server.api.auth'
import { Route as RootRoute } from '../[.]well-known.oauth-authorization-server'

type Handlers = { GET: (args: { request: Request }) => Promise<Response> }
type TestRoute = { path: string; options: { server: { handlers: Handlers } } }

async function fetchMetadata(route: unknown, url: string) {
  const { GET } = (route as TestRoute).options.server.handlers
  const response = await GET({ request: new Request(url) })
  expect(response.status).toBe(200)
  return (await response.json()) as { issuer: string }
}

describe('OAuth authorization server discovery for /api/mcp', () => {
  const advertised = mcpProtectedResourceMetadata(BASE_URL).authorization_servers[0]
  const issuerPath = new URL(advertised).pathname.replace(/\/$/, '')

  it('serves metadata at the RFC 8414 path derived from the advertised issuer', () => {
    expect((PathInsertedRoute as unknown as TestRoute).path).toBe(
      `/.well-known/oauth-authorization-server${issuerPath}`
    )
  })

  it('returns an issuer equal to the advertised authorization server', async () => {
    const body = await fetchMetadata(
      PathInsertedRoute,
      `${BASE_URL}/.well-known/oauth-authorization-server${issuerPath}`
    )
    expect(body.issuer).toBe(advertised)
  })

  it('returns the same issuer from the root well-known URL', async () => {
    const body = await fetchMetadata(
      RootRoute,
      `${BASE_URL}/.well-known/oauth-authorization-server`
    )
    expect(body.issuer).toBe(advertised)
  })
})
