/**
 * MCP HTTP Request Handler
 *
 * Supports dual authentication:
 * 1. OAuth access token (JWT verified via JWKS, no DB round-trip)
 * 2. API key (from CI/programmatic use with qb_xxx tokens)
 *
 * When neither auth method succeeds, returns 401 with WWW-Authenticate
 * header pointing to the protected resource metadata, which triggers
 * the MCP SDK's OAuth discovery flow.
 */

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { verifyAccessToken } from 'better-auth/oauth2'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { getDeveloperConfig } from '@/lib/server/domains/settings/settings.service'
import { db, principal, eq } from '@/lib/server/db'
import { config } from '@/lib/server/config'
import { createMcpServer } from './server'
import type { McpAuthContext, McpScope } from './types'

/** Build a JSON-RPC error response (used for MCP-level denials). */
function jsonRpcError(status: number, message: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32001, message },
      id: null,
    }),
    { status, headers: { 'Content-Type': 'application/json' } }
  )
}

const ALL_SCOPES: McpScope[] = ['read:feedback', 'write:feedback', 'write:changelog']

const API_KEY_PREFIX = 'qb_'

/** Extract Bearer token from Authorization header, or null. */
function extractBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  return header?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null
}

/**
 * Resolve auth from OAuth JWT access token.
 * Verifies the token signature via JWKS (no DB round-trip).
 * Custom claims (principalId, role) are embedded by the auth config.
 * Returns McpAuthContext if valid, null if not an OAuth token or verification fails.
 */
async function resolveOAuthContext(token: string): Promise<McpAuthContext | null> {
  if (token.startsWith(API_KEY_PREFIX)) return null

  try {
    const payload = await verifyAccessToken(token, {
      verifyOptions: {
        audience: `${config.baseUrl}/api/mcp`,
        issuer: `${config.baseUrl}/api/auth`,
      },
      jwksUrl: `${config.baseUrl}/api/auth/jwks`,
    })

    const principalId = payload.principalId as string | undefined
    const role = (payload.role as string) ?? 'user'
    const sub = payload.sub

    if (!principalId || !sub) return null

    // Parse granted scopes from space-separated string
    const scopeStr = (payload.scope as string) ?? ''
    const scopes = scopeStr
      .split(' ')
      .filter((s): s is McpScope => ALL_SCOPES.includes(s as McpScope))

    return {
      principalId: principalId as McpAuthContext['principalId'],
      userId: sub as McpAuthContext['userId'],
      name: (payload.name as string) ?? 'Unknown',
      email: payload.email as string | undefined,
      role: role as 'admin' | 'member' | 'user',
      authMethod: 'oauth',
      scopes,
    }
  } catch {
    return null
  }
}

/**
 * Resolve auth context: try OAuth token first, then API key.
 * Returns 401 with WWW-Authenticate header if both fail (triggers OAuth discovery).
 */
export async function resolveAuthContext(request: Request): Promise<McpAuthContext | Response> {
  const token = extractBearerToken(request)

  // 1. Try OAuth access token
  if (token) {
    const oauthContext = await resolveOAuthContext(token)
    if (oauthContext) return oauthContext
  }

  // 2. Try API key
  if (token?.startsWith(API_KEY_PREFIX)) {
    const authResult = await withApiKeyAuth(request, { role: 'team' })
    if (authResult instanceof Response) return authResult

    const principalRecord = await db.query.principal.findFirst({
      where: eq(principal.id, authResult.principalId),
      with: { user: true },
    })

    if (!principalRecord) {
      return new Response(JSON.stringify({ error: 'Principal not found' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Service principals (API keys) use displayName; human principals use user.name
    if (principalRecord.type === 'service') {
      return {
        principalId: authResult.principalId,
        name: principalRecord.displayName ?? authResult.apiKey.name,
        role: authResult.role as 'admin' | 'member' | 'user',
        authMethod: 'api-key',
        scopes: ALL_SCOPES,
      }
    }

    // Human principal (legacy path, shouldn't happen with new keys)
    return {
      principalId: authResult.principalId,
      userId: principalRecord.user?.id,
      name: principalRecord.displayName ?? principalRecord.user?.name ?? 'Unknown',
      email: principalRecord.user?.email,
      role: authResult.role as 'admin' | 'member' | 'user',
      authMethod: 'api-key',
      scopes: ALL_SCOPES,
    }
  }

  // 3. No valid auth — return 401 with OAuth discovery hint
  return new Response(JSON.stringify({ error: 'Authentication required' }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer resource_metadata="${config.baseUrl}/.well-known/oauth-protected-resource"`,
    },
  })
}

/** Create a stateless transport + server, handle the request, clean up */
export async function handleMcpRequest(request: Request): Promise<Response> {
  const devConfig = await getDeveloperConfig()
  if (!devConfig.mcpEnabled) {
    return jsonRpcError(
      403,
      'MCP server is disabled. Enable it in Settings > Developers > MCP Server.'
    )
  }

  const auth = await resolveAuthContext(request)
  if (auth instanceof Response) return auth

  // Portal user access check
  if (auth.role === 'user') {
    if (!devConfig.mcpPortalAccessEnabled) {
      return jsonRpcError(403, 'Portal user MCP access is disabled by the administrator.')
    }
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })

  const server = createMcpServer(auth)
  await server.connect(transport)

  try {
    return await transport.handleRequest(request)
  } finally {
    await transport.close()
    await server.close()
  }
}
