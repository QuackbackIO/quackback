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

import { createMcpHandler, isLegacyRequest } from '@modelcontextprotocol/server'
import type { Role } from '@/lib/shared/roles'
import { requestToResourceInput, verifyAccessTokenRequest } from 'better-auth/oauth2'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  API_KEY_SCOPES,
  effectiveScopes,
  hasApiScope,
} from '@/lib/server/domains/api-keys/api-key-scopes'
import {
  insufficientScopeChallenge,
  unauthenticatedMcpChallenge,
  unauthenticatedMcpResponse,
} from './oauth-challenge'
import { requiredScopesForMcpRpc } from './required-scope'
import { DomainException, RateLimitError } from '@/lib/shared/errors'
import { EntitlementRequiredError } from '@/lib/server/errors/entitlement-error'
import { getDeveloperConfig } from '@/lib/server/domains/settings/settings.service'
import { permissionsForPrincipal } from '@/lib/server/policy/permissions'
import type { PermissionKey } from '@/lib/shared/permissions'
import { config } from '@/lib/server/config'
import {
  apiKeyAttribution,
  MCP_ATTRIBUTION,
  oauthClientAttribution,
  runWithAuditAttribution,
  setAuditAttribution,
} from '@/lib/server/audit/attribution'
import { createMcpServer } from './server'
import { createMcpTransport } from './transport'
import { MCP_MAX_REQUEST_BYTES, MCP_UPLOAD_MAX_BYTES } from './tools/files'
import { contentLengthExceeds, readBodyWithLimit } from '@/lib/server/utils/read-body'
import { formatBytes } from '@/lib/shared/files/file-types'
import { readOAuthPrincipal } from './oauth-principal'
import { logMcpRequest, summarizeMcpRequest, type McpRequestSummary } from './request-log'
import { logger } from '@/lib/server/logger'
import type { PrincipalId } from '@quackback/ids'
import type { McpAuthContext, McpScope } from './types'

/**
 * JSON-RPC code for the handler's own refusals (MCP disabled, plan, portal
 * access). It sits in the range 2026-07-28 leaves to implementations
 * (-32000..-32019); -32020..-32099 are reserved for the spec.
 */
const MCP_REFUSED_ERROR_CODE = -32001

/** Build a JSON-RPC error response (used for MCP-level denials). */
function jsonRpcError(status: number, message: string, id: RpcId = null): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: MCP_REFUSED_ERROR_CODE, message },
      id,
    }),
    { status, headers: { 'Content-Type': 'application/json' } }
  )
}

/**
 * A refusal the caller can act on: the JSON-RPC error envelope every MCP client
 * already understands, at HTTP 402, carrying the plan that would grant the
 * server in `data` so a client can show the upgrade prompt rather than a bare
 * "denied".
 */
function jsonRpcEntitlementError(error: EntitlementRequiredError, id: RpcId = null): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: MCP_REFUSED_ERROR_CODE, message: error.message, data: error.toResponseBody() },
      id,
    }),
    { status: error.statusCode, headers: { 'Content-Type': 'application/json' } }
  )
}

export const ALL_SCOPES: McpScope[] = [...API_KEY_SCOPES]

const API_KEY_PREFIX = 'qb_'

/** Extract Bearer token from Authorization header, or null. */
function extractBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  return header?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null
}

/**
 * Resolve auth from OAuth JWT access token.
 * Verifies the token signature via JWKS, then re-reads the principal's
 * current role from the database so that role changes (demotions, etc.)
 * take effect immediately rather than at token expiry.
 * Returns McpAuthContext if valid, null if not an OAuth token or verification fails.
 */
async function resolveOAuthContext(
  request: Request,
  token: string
): Promise<McpAuthContext | null> {
  if (token.startsWith(API_KEY_PREFIX)) return null

  try {
    const payload = await verifyAccessTokenRequest(requestToResourceInput(request), {
      verifyOptions: {
        audience: `${config.baseUrl}/api/mcp`,
        issuer: `${config.baseUrl}/api/auth`,
      },
      jwksUrl: `${config.baseUrl}/api/auth/jwks`,
    })

    const principalId = payload.principalId as string | undefined
    const sub = payload.sub

    if (!principalId || !sub) return null

    // Re-read the principal's current role from the database so that
    // role changes made after token issuance take effect immediately.
    // If the principal no longer exists (deleted/revoked), reject the token.
    // The same read names the OAuth client for audit attribution.
    const clientId = oauthClientIdOf(payload)
    const principalRecord = await readOAuthPrincipal(principalId as PrincipalId, clientId)
    if (!principalRecord) return null

    // A paused seat (the plan has fewer team seats than members) acts as the
    // portal user it still is, with no team authority. OAuth tokens are only
    // ever issued to a person signing in.
    const { isPausedTeamSeat } = await import('@/lib/server/domains/plan-limits/plan-limits.seats')
    const paused = await isPausedTeamSeat({
      id: principalId,
      role: principalRecord.role,
      type: 'user',
    })
    const role = paused ? 'user' : principalRecord.role
    // The caller's current assignment-derived permissions, resolved as a
    // signed-in session resolves them, gate every tool. Portal users hold no
    // workspace assignments, so they skip the read.
    const permissions =
      role === 'user'
        ? new Set<PermissionKey>()
        : await permissionsForPrincipal(principalId as PrincipalId, role as Role)

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
      role: role as Role,
      permissions,
      authMethod: 'oauth',
      ...(typeof payload.azp === 'string' && payload.azp ? { credentialId: payload.azp } : {}),
      scopes,
      offlineAccess: scopeStr.split(' ').includes('offline_access'),
      auditAttribution: oauthClientAttribution({
        clientId,
        clientName: principalRecord.clientName,
        principalId: principalId as PrincipalId,
      }),
    }
  } catch {
    return null
  }
}

/** The client a JWT access token was issued to (`client_id`, or `azp`). */
function oauthClientIdOf(payload: Record<string, unknown>): string | null {
  const clientId = payload.client_id ?? payload.azp
  return typeof clientId === 'string' && clientId.length > 0 ? clientId : null
}

/**
 * Resolve auth context: try OAuth token first, then API key.
 * Returns 401 with WWW-Authenticate header if both fail (triggers OAuth discovery).
 */
export async function resolveAuthContext(request: Request): Promise<McpAuthContext | Response> {
  const token = extractBearerToken(request)

  // 1. Try OAuth access token
  if (token) {
    const oauthContext = await resolveOAuthContext(request, token)
    if (oauthContext) return oauthContext
  }

  // 2. Try API key
  if (token?.startsWith(API_KEY_PREFIX)) {
    let authResult
    try {
      // A valid key authenticates the MCP request; per-tool MCP scopes provide
      // authorization, resolved below from the key's stored scopes.
      authResult = await withApiKeyAuth(request)
    } catch (err) {
      if (!(err instanceof DomainException)) throw err
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (err instanceof RateLimitError) headers['Retry-After'] = String(err.retryAfter)
      if (err.statusCode === 401) {
        headers['WWW-Authenticate'] = unauthenticatedMcpChallenge()
      }
      return new Response(JSON.stringify({ error: err.message }), {
        status: err.statusCode,
        headers,
      })
    }

    // withApiKeyAuth already read the principal (with its linked user) in its
    // single per-request query; reuse that row instead of a second round-trip.
    const principalRecord = authResult.principal

    if (!principalRecord) {
      return new Response(JSON.stringify({ error: 'Principal not found' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // A key's MCP scopes are its stored scopes; keys created before scope
    // selection existed store NULL and keep full authority (deliberate
    // back-compat — the same rule the REST permission gates apply).
    const keyScopes = effectiveScopes(authResult.apiKey.scopes)

    // Changes made over MCP with a key are attributed to the key and to the
    // teammate who created it.
    const auditAttribution = apiKeyAttribution(authResult.apiKey, 'mcp')

    // Role and permissions are the key's authority exactly as the REST API
    // resolves it, capped at its creator's current access; the permission set
    // is the ceiling every MCP actor built from this context carries.
    // Service principals (API keys) use displayName; human principals use user.name.
    if (principalRecord.type === 'service') {
      return {
        principalId: authResult.principalId,
        name: principalRecord.displayName ?? authResult.apiKey.name,
        role: authResult.role as Role,
        permissions: authResult.permissions,
        ...(authResult.scopePrincipalId ? { scopePrincipalId: authResult.scopePrincipalId } : {}),
        authMethod: 'api-key',
        credentialId: authResult.apiKey.id,
        clientName: authResult.apiKey.name,
        scopes: keyScopes,
        auditAttribution,
      }
    }

    // Human principal (legacy path, shouldn't happen with new keys)
    return {
      principalId: authResult.principalId,
      userId: principalRecord.user?.id,
      name: principalRecord.displayName ?? principalRecord.user?.name ?? 'Unknown',
      email: principalRecord.user?.email ?? undefined,
      role: authResult.role as Role,
      permissions: authResult.permissions,
      ...(authResult.scopePrincipalId ? { scopePrincipalId: authResult.scopePrincipalId } : {}),
      authMethod: 'api-key',
      credentialId: authResult.apiKey.id,
      clientName: authResult.apiKey.name,
      scopes: keyScopes,
      auditAttribution,
    }
  }

  // 3. No valid auth — return 401 with OAuth discovery hint
  return unauthenticatedMcpResponse()
}

type RpcId = string | number | null

/** The request body as read once, up front, by handleMcpRequest. */
interface ReadBody {
  /** The request to hand on, its body replayed from the bytes already read. */
  request: Request
  /** The parsed JSON, whatever the content type; `undefined` when it is not JSON. */
  json: unknown
  /** The JSON-RPC payload: `json` for a JSON POST, otherwise `undefined` (the protocol leg answers that itself). */
  rpc: unknown
}

/**
 * Read the body once, never past MCP_MAX_REQUEST_BYTES: a body with no (or a
 * false) Content-Length is cut off at the cap instead of buffered whole.
 * `null` when the body is over the cap. A capped read of a clone cannot stop
 * early (cancelling one branch of a tee waits on the other), so the original
 * is read and a copy carrying the same bytes goes on to the transport.
 */
async function readBody(request: Request): Promise<ReadBody | null> {
  const bytes = await readBodyWithLimit(request, MCP_MAX_REQUEST_BYTES)
  if (bytes === null) return null
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    json = undefined
  }
  const contentType = request.headers.get('content-type') ?? ''
  return {
    request: new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: bytes,
      signal: request.signal,
    }),
    json,
    rpc: contentType.includes('application/json') ? json : undefined,
  }
}

/** The id of a single JSON-RPC request, so a refusal can answer it; null for a batch or none. */
function rpcIdOf(body: unknown): RpcId {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const id = (body as { id?: unknown }).id
  return typeof id === 'string' || typeof id === 'number' ? id : null
}

/**
 * OAuth-only: if this JSON-RPC call needs a scope the token lacks, return
 * HTTP 403 + `insufficient_scope` so the client can step up (see
 * `insufficientScopeChallenge`). API keys never enter this path.
 */
function oauthScopeStepUp(body: unknown, auth: McpAuthContext, modern: boolean): Response | null {
  if (body === undefined) return null
  // Every scope the request lacks goes in one challenge. Nothing in a batch
  // runs when any call in it is refused, so every call gets the refusal.
  const calls = Array.isArray(body) ? body : [body]
  const missing = new Set<string>()
  for (const call of calls) {
    for (const scope of requiredScopesForMcpRpc(call)) {
      if (!hasApiScope(auth.scopes, scope)) missing.add(scope)
    }
  }
  if (missing.size === 0) return null
  return insufficientScopeChallenge({
    missing: [...missing],
    held: auth.scopes,
    offlineAccess: auth.offlineAccess === true,
    calls: calls.map((call) => {
      const { id, method } = (call ?? {}) as { id?: unknown; method?: unknown }
      return {
        id: typeof id === 'string' || typeof id === 'number' ? id : null,
        method: typeof method === 'string' ? method : '',
      }
    }),
    batch: Array.isArray(body),
    modern,
  })
}

/**
 * Create a stateless transport + server, handle the request, clean up.
 *
 * The request is its own audit boundary from the first line, labelled MCP
 * before any auth runs: key auth fills this boundary with the key and keeps
 * the label, so nothing in an MCP request reads as the REST API.
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  // Stateless serving has no standalone server-to-client stream and no session
  // to delete. Answering GET with an event stream that ends at once made
  // clients reconnect in a loop, each time paying for auth, so GET and DELETE
  // are refused before any of that runs. Streamable HTTP allows exactly this.
  if (request.method !== 'POST') return methodNotAllowed()

  // Refused before anything reads the body (the request log, the JSON-RPC
  // parse, auth): an unauthenticated caller must not make the server buffer
  // an arbitrarily large body. Both protocol legs also cap what they read, but
  // answer with a bare byte count; most oversized requests are file uploads,
  // so say what the limit is for.
  if (contentLengthExceeds(request, MCP_MAX_REQUEST_BYTES)) return requestTooLarge()
  // The header is only a hint: a streamed body declares no length. Every
  // reader before the transport (the request log, the OAuth scope check)
  // shares this one capped read.
  const body = await readBody(request)
  if (!body) return requestTooLarge()

  const startedAt = Date.now()
  const summary = summarizeMcpRequest(body.request, body.json)
  const response = await runWithAuditAttribution(MCP_ATTRIBUTION, () =>
    handleMcpRequestInBoundary(body.request, body.rpc, summary)
  )
  await logMcpRequest(summary, response, startedAt)
  return response
}

/** 413 that names upload_file's limit and the REST alternative. */
function requestTooLarge(): Response {
  return jsonRpcError(
    413,
    `Request is too large (max ${formatBytes(MCP_MAX_REQUEST_BYTES)}). upload_file accepts files up to ${formatBytes(MCP_UPLOAD_MAX_BYTES)}; upload larger files with the REST API (POST /api/v1/files).`
  )
}

/** 405 for every method but POST, as Streamable HTTP allows. */
export function methodNotAllowed(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. Send MCP requests with POST.' },
      id: null,
    }),
    { status: 405, headers: { 'Content-Type': 'application/json', Allow: 'POST' } }
  )
}

async function handleMcpRequestInBoundary(
  request: Request,
  body: unknown,
  summary: McpRequestSummary
): Promise<Response> {
  const id = rpcIdOf(body)

  const devConfig = await getDeveloperConfig()
  if (!devConfig.mcpEnabled) {
    return jsonRpcError(
      403,
      'MCP server is disabled. Enable it in Settings > Developers > MCP Server.',
      id
    )
  }

  const auth = await resolveAuthContext(request)
  // resolveAuthContext returns a Response by design: it covers both OAuth and
  // API key auth paths, and the API key path converts failures to Response
  // objects internally rather than throwing.
  if (auth instanceof Response) return auth
  summary.authMethod = auth.authMethod
  if (auth.credentialId) summary.credentialId = auth.credentialId

  // From here on, everything in this request runs as the credential that
  // made it.
  if (auth.auditAttribution) setAuditAttribution(auth.auditAttribution)

  // The SDK's own era classification: a 2026-07-28 request carries its
  // revision in a per-request `_meta` envelope; everything else is 2025-era.
  const legacy = await isLegacyRequest(request, body, {
    maxRequestBodySize: MCP_MAX_REQUEST_BYTES,
  })

  if (auth.authMethod === 'oauth') {
    const denied = oauthScopeStepUp(body, auth, !legacy)
    if (denied) return denied
  }

  // Plan gate, deliberately after auth: a 402 names the workspace's plan, which
  // is an answer only a caller who has already identified itself should get.
  // Open on any install without a plan, which is every self-hosted one — see
  // domains/settings/cloud/entitlements.ts. MCP is not a plan limits grace
  // feature, so this is the plan's own grant, as before.
  const { isFeatureLive } = await import('@/lib/server/domains/plan-limits/plan-limits.service')
  if (!(await isFeatureLive('mcpServer'))) {
    const [{ buildRefusal }, { getCloudConfig }] = await Promise.all([
      import('@/lib/server/domains/settings/cloud/entitlements'),
      import('@/lib/server/domains/settings/cloud/cloud.service'),
    ])
    return jsonRpcEntitlementError(buildRefusal(await getCloudConfig(), 'mcpServer'), id)
  }

  // Portal user access check
  if (auth.role === 'user') {
    if (!devConfig.mcpPortalAccessEnabled) {
      return jsonRpcError(403, 'Portal user MCP access is disabled by the administrator.', id)
    }
  }

  return legacy ? serveLegacyRequest(request, auth) : serveModernRequest(request, auth)
}

function logTransportError(error: Error): void {
  // The SDK names the reason for a refusal it answers itself (an unsupported
  // protocol version, a header that disagrees with the body, a malformed
  // body); without this it is lost.
  logger.warn({ err: error }, 'mcp transport error')
}

/**
 * 2026-07-28 traffic: the SDK's per-request entry, which answers
 * `server/discover`, validates the `_meta` envelope and the `Mcp-Method` /
 * `Mcp-Name` headers, and adds `resultType` and the cache fields. It is built
 * per request around this caller's server, so nothing is shared between
 * requests. Legacy traffic never reaches it (`legacy: 'reject'`): it is routed
 * to serveLegacyRequest first, which keeps JSON responses for 2025 clients.
 */
async function serveModernRequest(request: Request, auth: McpAuthContext): Promise<Response> {
  const handler = createMcpHandler(() => createMcpServer(auth), {
    legacy: 'reject',
    responseMode: 'json',
    maxRequestBodySize: MCP_MAX_REQUEST_BYTES,
    onerror: logTransportError,
  })
  try {
    return await handler.fetch(request)
  } finally {
    await handler.close()
  }
}

/**
 * 2025-era traffic (`initialize`, then requests without the 2026 envelope):
 * stateless Streamable HTTP with JSON responses, as before the 2026 support.
 * The SDK's built-in legacy fallback answers over SSE instead, so it is not
 * used.
 */
async function serveLegacyRequest(request: Request, auth: McpAuthContext): Promise<Response> {
  const transport = createMcpTransport()
  transport.onerror = logTransportError

  const server = createMcpServer(auth)
  await server.connect(transport)

  try {
    return await transport.handleRequest(request)
  } finally {
    await transport.close()
    await server.close()
  }
}
