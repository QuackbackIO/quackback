/**
 * RFC 6750 / RFC 9728 challenges for the MCP resource server.
 *
 * Built here rather than via `createResourceServerChallenge` so the
 * `resource_metadata` URL stays the document clients already fetch
 * (`/.well-known/oauth-protected-resource`), not the path-inserted form.
 */
import { MCP_FIRST_CONNECT_SCOPES } from '@/lib/shared/api-key-scopes'
import { config } from '@/lib/server/config'

export const MCP_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource'

export function mcpResourceMetadataUrl(baseUrl = config.baseUrl): string {
  return `${baseUrl}${MCP_RESOURCE_METADATA_PATH}`
}

function quoteAuthParam(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function unauthenticatedMcpChallenge(): string {
  const scopes = MCP_FIRST_CONNECT_SCOPES.join(' ')
  return `Bearer scope="${quoteAuthParam(scopes)}", resource_metadata="${quoteAuthParam(mcpResourceMetadataUrl())}"`
}

export function insufficientScopeChallenge(scope: string): Response {
  const description = `access token is missing required scope: ${scope}`
  const header =
    `Bearer error="insufficient_scope", ` +
    `error_description="${quoteAuthParam(description)}", ` +
    `scope="${quoteAuthParam(scope)}", ` +
    `resource_metadata="${quoteAuthParam(mcpResourceMetadataUrl())}"`
  return new Response(
    JSON.stringify({ error: 'insufficient_scope', error_description: description }),
    {
      status: 403,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': header,
      },
    }
  )
}

export function unauthenticatedMcpResponse(): Response {
  return new Response(JSON.stringify({ error: 'Authentication required' }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': unauthenticatedMcpChallenge(),
    },
  })
}
