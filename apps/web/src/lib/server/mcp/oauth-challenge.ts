/**
 * RFC 6750 / RFC 9728 challenges for the MCP resource server.
 *
 * Built here rather than via `createResourceServerChallenge` so the
 * `resource_metadata` URL stays the document clients already fetch
 * (`/.well-known/oauth-protected-resource`), not the path-inserted form.
 */
import {
  ACCESS_DOMAINS,
  MCP_CHALLENGE_SCOPES,
  expandWriteGrants,
  orderScopes,
} from '@/lib/shared/api-key-scopes'
import { config } from '@/lib/server/config'

/** JSON-RPC server error code for a refused non-tool call. */
const INSUFFICIENT_SCOPE_ERROR_CODE = -32003

export const MCP_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource'

export function mcpResourceMetadataUrl(baseUrl = config.baseUrl): string {
  return `${baseUrl}${MCP_RESOURCE_METADATA_PATH}`
}

function quoteAuthParam(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function unauthenticatedMcpChallenge(): string {
  const scopes = MCP_CHALLENGE_SCOPES.join(' ')
  return `Bearer scope="${quoteAuthParam(scopes)}", resource_metadata="${quoteAuthParam(mcpResourceMetadataUrl())}"`
}

/** Says in plain words what a connection lacking these scopes cannot do. */
function insufficientScopeMessage(missing: readonly string[]): string {
  const lacks = missing.map((scope) => {
    const domain = ACCESS_DOMAINS.find((d) => d.writeScope === scope || d.readScope === scope)
    const area = domain?.label ?? scope
    return scope.startsWith('write:') ? `make changes to ${area}` : `read ${area}`
  })
  const what = lacks.length > 1 ? `${lacks.slice(0, -1).join(', ')} or ${lacks.at(-1)}` : lacks[0]
  return (
    `This connection is not allowed to ${what} (missing scope: ${missing.join(' ')}). ` +
    'Reconnect and choose Full access to allow it.'
  )
}

/**
 * The step-up challenge for a call whose token lacks a scope.
 *
 * `scope` is everything the retried call needs, not only what is missing: the
 * scopes the token already holds plus the missing ones (and the read each
 * write implies). A client that re-authorizes with exactly this set keeps the
 * access it had; one that unions it with its earlier request ends in the same
 * place. Every scope the request lacks goes in the one challenge.
 *
 * The response is HTTP 403 with the RFC 6750 header, which is what the MCP
 * spec asks for. Its body answers each refused call: a tool call as a tool
 * result that carries the challenge in `_meta["mcp/www_authenticate"]`, for
 * clients that read it there, and a message that tells a person what to do
 * when their client cannot step up; any other method as a JSON-RPC error with
 * the same message and challenge. A batch gets an array, one answer per call.
 *
 * A token that can refresh keeps `offline_access` in the scope it is asked to
 * re-request, so stepping up does not cost the connection its refresh token.
 */
export function insufficientScopeChallenge(input: {
  missing: readonly string[]
  held: readonly string[]
  /** The token can refresh: re-authorizing with the challenge keeps that. */
  offlineAccess?: boolean
  /** The refused request's calls. One with no id stands for a bare call. */
  calls?: readonly { id: string | number | null; method: string }[]
  batch?: boolean
  /** Shorthand for a single `tools/call`. */
  requestId?: string | number | null
}): Response {
  const missing = orderScopes(input.missing)
  const needed = [
    ...(input.offlineAccess ? ['offline_access'] : []),
    ...orderScopes([...input.held, ...expandWriteGrants(missing)]),
  ]
  const description = insufficientScopeMessage(missing)
  const header =
    `Bearer error="insufficient_scope", ` +
    `error_description="${quoteAuthParam(description)}", ` +
    `scope="${quoteAuthParam(needed.join(' '))}", ` +
    `resource_metadata="${quoteAuthParam(mcpResourceMetadataUrl())}"`
  const challenge = { 'mcp/www_authenticate': [header] }
  const calls = input.calls ?? [{ id: input.requestId ?? null, method: 'tools/call' }]
  // A tool call is refused as a tool result, which every client shows; any
  // other method (`resources/read`) as a JSON-RPC error, since its result has
  // a shape of its own.
  const answers = calls.map(({ id, method }) =>
    method === 'tools/call'
      ? {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: description }],
            isError: true,
            _meta: challenge,
          },
        }
      : {
          jsonrpc: '2.0',
          id,
          error: { code: INSUFFICIENT_SCOPE_ERROR_CODE, message: description, data: challenge },
        }
  )
  return new Response(JSON.stringify(input.batch ? answers : answers[0]), {
    status: 403,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': header,
    },
  })
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
