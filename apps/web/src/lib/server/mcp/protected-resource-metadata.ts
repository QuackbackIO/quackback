import { MCP_FIRST_CONNECT_SCOPES } from '@/lib/shared/api-key-scopes'

/**
 * RFC 9728 document for `/api/mcp`. First-connect scopes only — no writes, no AS-only scopes.
 *
 * `authorization_servers` is the issuer identifier, not the site origin.
 * Better Auth's issuer is `{origin}/api/auth`, and RFC 8414 requires clients
 * to fetch that issuer at `/.well-known/oauth-authorization-server/api/auth`
 * and reject the document when `issuer` does not match.
 */
export function mcpProtectedResourceMetadata(baseUrl: string) {
  return {
    resource: `${baseUrl}/api/mcp`,
    authorization_servers: [`${baseUrl}/api/auth`],
    bearer_methods_supported: ['header'],
    scopes_supported: [...MCP_FIRST_CONNECT_SCOPES],
  }
}

export function mcpProtectedResourceResponse(baseUrl: string): Response {
  return new Response(JSON.stringify(mcpProtectedResourceMetadata(baseUrl)), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
      Vary: 'Host',
    },
  })
}
