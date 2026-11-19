/**
 * Who is really asking, for the OAuth consent screen.
 *
 * A client's name is whatever it said it was. A client that registered through
 * DCR can call itself "ChatGPT", so the consent screen must not present that
 * name as fact. What the server can vouch for differs by how the client
 * arrived:
 *
 * - A CIMD client (`clientDiscoveryId === 'cimd'`) is identified by an HTTPS
 *   URL whose document the server fetched itself. The host of that URL is
 *   verified: only whoever controls it could have served the document.
 * - Any other client registered itself. Nothing about it is verified.
 *
 * Either way the redirect URI decides where the authorization code goes, so
 * its host is always shown (MCP authorization security: the server MUST
 * clearly display the redirect URI hostname). A verified host does not make a
 * loopback redirect safe: CIMD cannot stop a local program from claiming a
 * client whose document lists `localhost` redirects, so the screen warns when
 * the code goes to this device.
 *
 * Decided from the stored row on the server, never from the shape of the
 * `client_id` the browser holds.
 */
import { CIMD_CLIENT_DISCOVERY_ID, clientIdMetadataHost } from './cimd'

export type ConsentRedirectTarget =
  /** An HTTPS or non-loopback HTTP redirect: the code goes to this host. */
  | { kind: 'web'; host: string }
  /** A loopback redirect: the code goes to an app on the person's own device. */
  | { kind: 'device' }
  /** A private-use scheme (`cursor://…`): the code goes to the app registered for it. */
  | { kind: 'app'; scheme: string }

export type ConsentClientIdentity =
  | { verified: true; host: string; redirect: ConsentRedirectTarget | null }
  | { verified: false; redirect: ConsentRedirectTarget | null }

export interface ConsentClientRow {
  clientId: string
  clientDiscoveryId: string | null
  redirectUris: string[] | null
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  )
}

export function describeRedirectUri(uri: string): ConsentRedirectTarget | null {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return null
  }
  if (url.protocol === 'https:' || url.protocol === 'http:') {
    if (isLoopbackHost(url.hostname)) return { kind: 'device' }
    return { kind: 'web', host: url.hostname }
  }
  return { kind: 'app', scheme: url.protocol.slice(0, -1) }
}

/**
 * Whether `requested` is one of the client's registered redirect URIs, as the
 * authorize endpoint decides it: exactly, or for a loopback redirect with any
 * port (RFC 8252 §7.3; native apps such as Claude Code register
 * `http://localhost/callback` and listen on a port chosen at run time). The
 * scheme, host, path and query must still match.
 */
export function isRegisteredRedirectUri(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true
  let want: URL
  try {
    want = new URL(requested)
  } catch {
    return false
  }
  if (want.protocol !== 'http:' || !isLoopbackHost(want.hostname)) return false
  return registered.some((uri) => {
    try {
      const have = new URL(uri)
      return (
        have.protocol === want.protocol &&
        have.hostname === want.hostname &&
        have.pathname === want.pathname &&
        have.search === want.search
      )
    } catch {
      return false
    }
  })
}

/**
 * The identity to show. `requestedRedirectUri` is the authorize request's
 * `redirect_uri`; it counts only when it matches a registered one, since that
 * is the one the authorize endpoint accepted. With none, a client with a
 * single registered redirect shows that one.
 */
export function consentClientIdentity(
  row: ConsentClientRow,
  requestedRedirectUri?: string | null
): ConsentClientIdentity {
  const registered = row.redirectUris ?? []
  const redirectUri =
    requestedRedirectUri && isRegisteredRedirectUri(registered, requestedRedirectUri)
      ? requestedRedirectUri
      : registered.length === 1
        ? registered[0]
        : null
  const redirect = redirectUri ? describeRedirectUri(redirectUri) : null
  if (row.clientDiscoveryId === CIMD_CLIENT_DISCOVERY_ID) {
    const host = clientIdMetadataHost(row.clientId)
    if (host) return { verified: true, host, redirect }
  }
  return { verified: false, redirect }
}

/**
 * Add `client_identity` to a successful `/oauth2/public-client` response.
 * Better Auth has already checked the session and that the client exists and
 * is enabled; this only reads the row it found. Any other response passes
 * through untouched.
 */
export async function withConsentClientIdentity(
  request: Request,
  response: Response
): Promise<Response> {
  if (!response.ok) return response
  const url = new URL(request.url)
  const clientId = url.searchParams.get('client_id')
  if (!clientId) return response
  const payload = (await response.clone().json()) as Record<string, unknown>
  const { db, oauthClient, eq } = await import('@/lib/server/db')
  const row = await db.query.oauthClient.findFirst({
    where: eq(oauthClient.clientId, clientId),
    columns: { clientId: true, clientDiscoveryId: true, redirectUris: true },
  })
  if (!row) return response
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return Response.json(
    {
      ...payload,
      client_identity: consentClientIdentity(row, url.searchParams.get('redirect_uri')),
    },
    { status: response.status, headers }
  )
}
