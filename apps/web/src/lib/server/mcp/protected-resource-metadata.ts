import { MCP_FIRST_CONNECT_SCOPES } from '@/lib/shared/api-key-scopes'

/** RFC 9728 document for `/api/mcp`. First-connect scopes only — no writes, no AS-only scopes. */
export function mcpProtectedResourceMetadata(baseUrl: string) {
  return {
    resource: `${baseUrl}/api/mcp`,
    authorization_servers: [baseUrl],
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
