/**
 * MCP HTTP Request Handler
 *
 * Supports dual authentication:
 * 1. OAuth access token (opaque reference token from Better Auth OAuth 2.1 flow)
 * 2. API key (from CI/programmatic use with qb_xxx tokens)
 *
 * When neither auth method succeeds, returns 401 with WWW-Authenticate
 * header pointing to the protected resource metadata, which triggers
 * the MCP SDK's OAuth discovery flow.
 */

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { getDeveloperConfig } from '@/lib/server/domains/settings/settings.service'
import { db, principal, oauthAccessToken, eq } from '@/lib/server/db'
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
 * Hash an OAuth token the same way Better Auth does for storage:
 * SHA-256 digest → base64url (no padding).
 */
async function hashOAuthToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  // base64url encode without padding
  let b64 = Buffer.from(hashBuffer).toString('base64')
  b64 = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return b64
}

/**
 * Resolve auth from OAuth opaque access token.
 * Better Auth stores tokens as SHA-256 base64url hashes, so we hash
 * the incoming token and look it up in the oauthAccessToken table.
 * Returns McpAuthContext if valid, null if not an OAuth token or lookup fails.
 */
async function resolveOAuthContext(token: string): Promise<McpAuthContext | null> {
  if (token.startsWith(API_KEY_PREFIX)) return null

  try {
    const hashedToken = await hashOAuthToken(token)
    const tokenRecord = await db.query.oauthAccessToken.findFirst({
      where: eq(oauthAccessToken.token, hashedToken),
    })

    if (!tokenRecord?.userId) return null

    // Check expiration
    if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) return null

    // Find the principal for this user
    const principalRecord = await db.query.principal.findFirst({
      where: eq(principal.userId, tokenRecord.userId!),
      with: { user: true },
    })

    if (!principalRecord?.user) return null

    // Parse granted scopes from token's scopes array
    const scopes = (tokenRecord.scopes ?? []).filter((s): s is McpScope =>
      ALL_SCOPES.includes(s as McpScope)
    )

    return {
      principalId: principalRecord.id,
      userId: principalRecord.user.id,
      name: principalRecord.user.name,
      email: principalRecord.user.email,
      role: principalRecord.role as 'admin' | 'member' | 'user',
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

    if (!principalRecord?.user) {
      return new Response(JSON.stringify({ error: 'Member not found' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return {
      principalId: authResult.principalId,
      userId: principalRecord.user.id,
      name: principalRecord.user.name,
      email: principalRecord.user.email,
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
