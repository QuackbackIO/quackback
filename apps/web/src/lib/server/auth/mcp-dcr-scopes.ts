import { MCP_AS_SCOPES } from '@/lib/shared/api-key-scopes'

/**
 * Better Auth 1.7.4 `validateClientRedirectUri` rejects host-bearing private-use
 * schemes (`cursor://anysphere.cursor-mcp/oauth/callback`). Cursor also omits
 * `application_type`, so DCR defaults to `web` and fails earlier with
 * "web clients require https redirect URIs on non-loopback hosts".
 *
 * Upstream: better-auth#10946 / unmerged PR #10956. We do not rewrite the
 * client's authorize `redirect_uri` — it must exact-match the stored row.
 * Authorize itself only checks `findRegisteredRedirectUri`, so restoring the
 * real URIs after DCR is enough.
 *
 * @see https://github.com/better-auth/better-auth/issues/10946
 */
export const BA_DCR_PLACEHOLDER_REDIRECT_URI = 'http://127.0.0.1:9/__ba_dcr_placeholder'

const FORBIDDEN_NATIVE_REDIRECT_SCHEMES = new Set([
  'file:',
  'ftp:',
  'mailto:',
  'javascript:',
  'data:',
  'vbscript:',
])

const REVERSE_DOMAIN_PRIVATE_USE_SCHEME =
  /^[a-z](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i

function isReverseDomainPrivateUseRedirectUri(uri: URL): boolean {
  const scheme = uri.protocol.slice(0, -1)
  const schemeSpecificPart = uri.href.slice(uri.protocol.length)
  return (
    uri.protocol !== 'http:' &&
    uri.protocol !== 'https:' &&
    uri.host.length === 0 &&
    schemeSpecificPart.startsWith('/') &&
    !schemeSpecificPart.startsWith('//') &&
    REVERSE_DOMAIN_PRIVATE_USE_SCHEME.test(scheme)
  )
}

function parseRedirectUris(value: unknown): string[] | null {
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return value
  }
  if (typeof value === 'string' && value.length > 0) return [value]
  return null
}

/**
 * Host-bearing or undotted custom schemes that 1.7.4 native DCR rejects, but
 * that MCP desktop clients (Cursor) actually send. Reserved schemes stay
 * untouched so Better Auth still 400s them.
 */
export function needsBetterAuth17RedirectRewrite(uri: string): boolean {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return false
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') return false
  if (FORBIDDEN_NATIVE_REDIRECT_SCHEMES.has(url.protocol)) return false
  if (uri.includes('#') || url.username.length > 0 || url.password.length > 0) return false
  return !isReverseDomainPrivateUseRedirectUri(url)
}

export function redirectUrisForBetterAuth17Native(uris: string[]): string[] {
  return uris.map((uri) =>
    needsBetterAuth17RedirectRewrite(uri) ? BA_DCR_PLACEHOLDER_REDIRECT_URI : uri
  )
}

/**
 * Original `redirect_uris` to write back after Better Auth persists the
 * placeholder. `null` when DCR already stores what the client sent.
 */
export function mcpDcrRedirectUrisToRestore(body: Record<string, unknown>): string[] | null {
  const original = parseRedirectUris(body.redirect_uris)
  if (!original) return null
  const forBa = redirectUrisForBetterAuth17Native(original)
  if (original.length === forBa.length && original.every((uri, i) => uri === forBa[i])) {
    return null
  }
  return original
}

/**
 * Persist the full authorization-server allow-list on a DCR client row.
 * Cursor registers with read defaults; without this, a later write step-up
 * fails with `invalid_scope` because the client row never listed writes.
 *
 * MCP DCR clients are native (desktop). Forcing `native` also covers Cursor
 * builds that omit `application_type` (Better Auth 1.7 defaults omitted → web).
 */
export function mcpDcrRegistrationBody(body: Record<string, unknown>): Record<string, unknown> {
  const redirectUris = parseRedirectUris(body.redirect_uris)
  const rewritten = redirectUris ? redirectUrisForBetterAuth17Native(redirectUris) : null
  const usedNativeRedirectRewrite = Boolean(
    redirectUris && rewritten && redirectUris.some((uri, i) => uri !== rewritten[i])
  )
  return {
    ...body,
    scope: MCP_AS_SCOPES.join(' '),
    // Only force native when we had to swap a host-bearing private-use
    // scheme for the 1.7.4 placeholder. HTTPS web clients keep `web`.
    ...(usedNativeRedirectRewrite ? { application_type: 'native' } : {}),
    ...(rewritten ? { redirect_uris: rewritten } : {}),
  }
}

export async function restoreMcpDcrRegisteredRedirectUris(
  response: Response,
  redirectUris: string[]
): Promise<Response> {
  const payload = (await response.json()) as Record<string, unknown>
  const clientId = typeof payload.client_id === 'string' ? payload.client_id : null
  if (!clientId) {
    return Response.json(
      {
        error: 'server_error',
        error_description: 'Registered client was missing client_id',
      },
      { status: 500 }
    )
  }
  const { db, oauthClient, eq } = await import('@/lib/server/db')
  await db.update(oauthClient).set({ redirectUris }).where(eq(oauthClient.clientId, clientId))
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return Response.json(
    { ...payload, redirect_uris: redirectUris },
    { status: response.status, headers }
  )
}
