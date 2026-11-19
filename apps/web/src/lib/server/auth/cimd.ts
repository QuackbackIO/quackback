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
 * Client capabilities: a discovered client is stored with the union of the
 * provider's `clientRegistrationDefaultScopes` and
 * `clientRegistrationAllowedScopes`, which is the full MCP scope catalogue, and
 * is linked to the `/api/mcp` resource by `clientRegistrationDefaultResources`.
 * That is the same capability set the DCR register interceptor writes, so the
 * 403 step-up works the same for both.
 */
import { cimd, type CimdClientCreatedEvent, type CimdClientRefreshedEvent } from '@better-auth/cimd'
import { fetchClientMetadataResource } from '@better-auth/cimd/node'
import { getSessionFromCtx } from 'better-auth/api'
import type { UserId } from '@quackback/ids'
import type { AuditActor } from '@/lib/server/audit/log'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'oauth-cimd' })

/** The discovery id Better Auth stores on a CIMD-owned client row. */
export const CIMD_CLIENT_DISCOVERY_ID = 'cimd'

/**
 * Fetch policy, checked before any network access: an HTTPS URL with a path
 * below the root, no credentials and no fragment. Any host is allowed (MCP is
 * an open ecosystem); the transport, not this check, keeps the fetch off
 * private addresses.
 */
export function isClientIdMetadataUrlAllowed(clientIdUrl: string): boolean {
  let url: URL
  try {
    url = new URL(clientIdUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  if (clientIdUrl.includes('#')) return false
  return url.pathname.length > 1
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
  const { recordAuditEvent } = await import('@/lib/server/audit/log')
  await recordAuditEvent({
    event: 'oauth.client.refreshed',
    actor: await actorFromContext(event.context),
    headers: event.context.headers ?? undefined,
    target: { type: 'oauth_client', id: event.client.clientId },
    before,
    after,
    metadata: summary,
  })
}

/**
 * The `cimd()` plugin for the MCP authorization server. Must follow `mcp()`,
 * which supplies the OAuth provider it extends.
 */
export function mcpCimdPlugin() {
  return cimd({
    fetchClientMetadataResource,
    metadataProfile: 'mcp-2026-07-28',
    isMetadataDocumentUrlAllowed: (clientIdUrl) => isClientIdMetadataUrlAllowed(clientIdUrl),
    onClientCreated: auditCimdClientCreated,
    onClientRefreshed: auditCimdClientRefreshed,
  })
}
