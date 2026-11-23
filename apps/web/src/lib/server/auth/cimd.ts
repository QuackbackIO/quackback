/**
 * OAuth Client ID Metadata Documents (CIMD) for MCP clients.
 *
 * An MCP client can use an HTTPS URL as its `client_id`. The authorization
 * server fetches the JSON document at that URL, checks it names the same URL,
 * and creates (or refreshes) a client row owned by the `cimd` discovery. The
 * client never calls `/oauth2/register`. MCP 2026-07-28 recommends this over
 * dynamic client registration, which stays available for clients without it.
 *
 * The fetch goes to a URL anyone can choose, so the transport is the SSRF
 * boundary. `@better-auth/cimd/node` resolves DNS once, refuses any answer
 * that is not public-routable (RFC 6890 special-use ranges, loopback, link
 * local, cloud metadata), connects only to the validated addresses while
 * keeping the hostname for Host, SNI and certificate checks, and never follows
 * a redirect. Production runs on Bun; `cimd-transport.test.ts` runs the same
 * transport under Bun in CI to prove Bun's `node:https` honours that pin. The
 * plugin adds a 5 s timeout, a 5 KB body cap and a JSON content type check.
 *
 * Resilience: the document cache lives in the auth instance, and a workspace's
 * instance is rebuilt after its pool goes idle, so a cold instance refetches
 * on first use. The plugin fails closed when that refetch fails for any
 * reason, which would let a brief outage at the client's host, or anyone who
 * drains the fetch budget, lock out clients people already connected. The
 * draft says an authorization server SHOULD NOT discard previously validated
 * metadata on transient failures (§6.1), so `resilientDiscovery` keeps using
 * the stored row when a refetch fails transiently (network error, timeout,
 * HTTP 5xx/408/429, or the fetch budget) and the row was validated within
 * `CIMD_MAX_STALE_MS`. A terminal failure (the document is gone, invalid, or
 * names another client_id) still fails closed, and so does a first fetch.
 *
 * Client capabilities: a discovered client is stored with the union of the
 * provider's `clientRegistrationDefaultScopes` and
 * `clientRegistrationAllowedScopes`, which is the full MCP scope catalogue, and
 * is linked to the `/api/mcp` resource by `clientRegistrationDefaultResources`.
 * That is the same capability set the DCR register interceptor writes, so the
 * 403 step-up works the same for both.
 *
 * Registration switch: the workspace's "Dynamic client registration" setting
 * covers both ways a new app registers. When it is off, `registrationGatedDiscovery`
 * refuses a client_id with no stored row, before any fetch, with the error the
 * register endpoint returns, and the discovery metadata stops advertising
 * `client_id_metadata_document_supported`. A client that registered while it
 * was on keeps working (refetches included), as a registered client does.
 */
import {
  createCimdClientDiscovery,
  type CimdClientCreatedEvent,
  type CimdClientRefreshedEvent,
} from '@better-auth/cimd'
import { fetchClientMetadataResource } from '@better-auth/cimd/node'
import { extendOAuthProvider, type ClientDiscovery } from '@better-auth/oauth-provider'
import { APIError, getSessionFromCtx } from 'better-auth/api'
import type { UserId } from '@quackback/ids'
import type { AuditActor } from '@/lib/server/audit/log'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'oauth-cimd' })

/** The discovery id Better Auth stores on a CIMD-owned client row. */
export const CIMD_CLIENT_DISCOVERY_ID = 'cimd'

/**
 * Fetch policy, checked before any network access: an HTTPS URL with a path
 * below the root, no credentials and no fragment. Any host is allowed (MCP is
 * an open ecosystem) except this server's own: a document served from here
 * (an upload, an API response) would otherwise appear on the consent screen
 * as "Verified" by this workspace's own domain (draft §10.1). The transport,
 * not this check, keeps the fetch off private addresses.
 */
export function isClientIdMetadataUrlAllowed(
  clientIdUrl: string,
  ownHosts: readonly string[] = []
): boolean {
  let url: URL
  try {
    url = new URL(clientIdUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  if (clientIdUrl.includes('#')) return false
  if (ownHosts.some((host) => host.toLowerCase() === url.hostname.toLowerCase())) return false
  return url.pathname.length > 1
}

/** The hosts this server answers on for one request: its base URL and the request's own host. */
export function ownHostsOf(context: {
  context?: { baseURL?: string }
  request?: Request
  headers?: Headers
}): string[] {
  const hosts = new Set<string>()
  const add = (value: string | null | undefined) => {
    if (!value) return
    try {
      hosts.add(new URL(value.includes('://') ? value : `https://${value}`).hostname)
    } catch {
      // Not a host; nothing to add.
    }
  }
  add(context.context?.baseURL)
  add(context.request?.url)
  add(context.headers?.get('host'))
  add(context.headers?.get('x-forwarded-host')?.split(',')[0]?.trim())
  return [...hosts]
}

/** The host a CIMD client_id proves control of: the URL's punycode hostname. */
export function clientIdMetadataHost(clientId: string): string | null {
  try {
    const url = new URL(clientId)
    return url.protocol === 'https:' ? url.hostname : null
  } catch {
    return null
  }
}

/** The signed-in person whose authorize request made the fetch, when there is one. */
async function actorFromContext(context: CimdClientCreatedEvent['context']): Promise<AuditActor> {
  const signedIn = await getSessionFromCtx(
    context as Parameters<typeof getSessionFromCtx>[0]
  ).catch(() => null)
  const user = signedIn?.user
  return user?.id
    ? { userId: user.id as UserId, email: user.email ?? null, type: 'user' }
    : { type: 'anonymous' }
}

function documentSummary(event: CimdClientCreatedEvent | CimdClientRefreshedEvent) {
  const doc = event.clientMetadataDocument
  return {
    clientId: event.client.clientId,
    host: clientIdMetadataHost(event.client.clientId),
    clientName: doc.client_name ?? null,
    redirectUris: doc.redirect_uris ?? [],
    tokenEndpointAuthMethod: doc.token_endpoint_auth_method ?? null,
  }
}

export async function auditCimdClientCreated(event: CimdClientCreatedEvent): Promise<void> {
  const summary = documentSummary(event)
  log.info(summary, 'oauth client created from its metadata document')
  const { recordAuditEvent } = await import('@/lib/server/audit/log')
  await recordAuditEvent({
    event: 'oauth.client.discovered',
    actor: await actorFromContext(event.context),
    headers: event.context.headers ?? undefined,
    target: { type: 'oauth_client', id: event.client.clientId },
    after: { name: event.client.name ?? null, redirectUris: event.client.redirectUris ?? [] },
    metadata: summary,
  })
}

export async function auditCimdClientRefreshed(event: CimdClientRefreshedEvent): Promise<void> {
  const before = {
    name: event.previousClient.name ?? null,
    redirectUris: event.previousClient.redirectUris ?? [],
  }
  const after = { name: event.client.name ?? null, redirectUris: event.client.redirectUris ?? [] }
  // A refresh that changed nothing a person sees is routine revalidation.
  if (JSON.stringify(before) === JSON.stringify(after)) return
  const summary = documentSummary(event)
  log.info(summary, 'oauth client refreshed from a changed metadata document')

  // New redirect URIs send future authorization codes somewhere a person never
  // approved, so earlier consent must not carry over (draft §10.5): the next
  // authorize asks again. Issued tokens are untouched; they never go to a
  // redirect URI.
  const redirectsChanged =
    JSON.stringify([...before.redirectUris].sort()) !==
    JSON.stringify([...after.redirectUris].sort())
  if (redirectsChanged) await forgetConsentFor(event.client.clientId)

  const { recordAuditEvent } = await import('@/lib/server/audit/log')
  await recordAuditEvent({
    event: 'oauth.client.refreshed',
    actor: await actorFromContext(event.context),
    headers: event.context.headers ?? undefined,
    target: { type: 'oauth_client', id: event.client.clientId },
    before,
    after,
    metadata: { ...summary, consentCleared: redirectsChanged },
  })
}

/** Remove every stored consent for a client, so each person approves it again. */
async function forgetConsentFor(clientId: string): Promise<void> {
  const { db, oauthConsent, eq } = await import('@/lib/server/db')
  await db.delete(oauthConsent).where(eq(oauthConsent.clientId, clientId))
}

/**
 * How long a stored CIMD client stays usable while its document cannot be
 * refetched for a transient reason. The draft sets no limit; a week covers an
 * outage at the client's host without keeping a client alive indefinitely on
 * metadata nobody can confirm.
 */
export const CIMD_MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000

/** The plugin's description for a fetch that never got a response. */
const NETWORK_FAILURE = 'Failed to fetch metadata document (network error or redirect blocked)'

/**
 * Whether a resolver error is transient: the client's host or this server's
 * fetch budget, not the document, is the problem. The plugin reports every
 * fetch failure as an APIError, so this reads its OAuth error body. Redirects
 * share the network-failure description; a redirect is refused before any
 * client row exists, and a client that starts redirecting later keeps working
 * on its stored row only until the stale limit.
 */
export function isTransientCimdFailure(error: unknown): boolean {
  const body = (error as { body?: { error?: unknown; error_description?: unknown } } | null)?.body
  if (!body || typeof body !== 'object') return false
  if (body.error === 'temporarily_unavailable') return true
  if (body.error !== 'invalid_client' || typeof body.error_description !== 'string') return false
  const description = body.error_description
  if (description === NETWORK_FAILURE) return true
  if (/^Metadata document fetch timed out/.test(description)) return true
  return /^Metadata document fetch returned HTTP (5\d\d|408|429)$/.test(description)
}

/** When a stored client row was last confirmed against its document. */
function lastValidatedAt(client: {
  updatedAt?: Date | string | null
  createdAt?: Date | string | null
}) {
  const value = client.updatedAt ?? client.createdAt
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

/**
 * Wrap a discovery so a transient refetch failure falls back to the stored,
 * recently validated client row instead of failing closed.
 */
export function resilientDiscovery(
  discovery: ClientDiscovery,
  options: { maxStaleMs?: number; now?: () => number } = {}
): ClientDiscovery {
  const maxStaleMs = options.maxStaleMs ?? CIMD_MAX_STALE_MS
  const now = options.now ?? Date.now
  return {
    ...discovery,
    resolve: async (ctx, clientId, existing) => {
      try {
        return await discovery.resolve(ctx, clientId, existing)
      } catch (error) {
        const owned = existing?.clientDiscoveryId === discovery.id
        const validatedAt = existing ? lastValidatedAt(existing) : null
        if (
          !existing ||
          !owned ||
          existing.disabled ||
          validatedAt === null ||
          now() - validatedAt > maxStaleMs ||
          !isTransientCimdFailure(error)
        ) {
          throw error
        }
        const body = (error as { body?: { error_description?: unknown } }).body
        log.warn(
          {
            clientId,
            reason: body?.error_description ?? null,
            validatedAgeMs: now() - validatedAt,
          },
          'oauth client metadata refetch failed transiently; using the stored client'
        )
        return existing
      }
    },
  }
}

/**
 * Wrap a discovery so it follows the workspace's registration switch. Off: a
 * client_id with no stored row is refused before any fetch, with the error the
 * register endpoint returns when registration is off, and the discovery stops
 * advertising itself. A stored client still resolves, so apps connected
 * earlier keep working. The id, `matches` and transport stay, because the
 * provider needs them to serve a stored client this discovery owns.
 */
export function registrationGatedDiscovery(
  discovery: ClientDiscovery,
  options: { allowNewClients: boolean }
): ClientDiscovery {
  if (options.allowNewClients) return discovery
  return {
    ...discovery,
    discoveryMetadata: { client_id_metadata_document_supported: false },
    resolve: async (ctx, clientId, existing) => {
      if (existing) return discovery.resolve(ctx, clientId, existing)
      log.info(
        { host: clientIdMetadataHost(clientId) },
        'oauth client metadata document refused: client registration is off'
      )
      throw new APIError('FORBIDDEN', {
        error: 'access_denied',
        error_description: 'Client registration is disabled',
      })
    },
  }
}

/**
 * The CIMD plugin for the MCP authorization server. Must follow `mcp()`, which
 * supplies the OAuth provider it extends. Built from the plugin's discovery so
 * the resolver can be wrapped; the id and version match `cimd()`.
 * `allowNewClients` is the workspace's registration switch, read when the auth
 * instance is built, as the register endpoint's is.
 */
export function mcpCimdPlugin(options: { allowNewClients: boolean }) {
  const discovery = registrationGatedDiscovery(
    resilientDiscovery(
      createCimdClientDiscovery({
        fetchClientMetadataResource,
        metadataProfile: 'mcp-2026-07-28',
        isMetadataDocumentUrlAllowed: (clientIdUrl, context) =>
          isClientIdMetadataUrlAllowed(clientIdUrl, ownHostsOf(context)),
        onClientCreated: auditCimdClientCreated,
        onClientRefreshed: auditCimdClientRefreshed,
      })
    ),
    options
  )
  return {
    id: 'cimd',
    init(ctx: Parameters<typeof extendOAuthProvider>[0]) {
      extendOAuthProvider(ctx, { clientDiscovery: discovery })
    },
  }
}
