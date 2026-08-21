/**
 * OAuth client for a remote MCP connector. Tokens live on the connector row
 * (encrypted, purpose connector-secrets). Refresh uses a 5-minute buffer and
 * flips the row to "needs attention" when it fails.
 */
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import type { ConnectorId } from '@quackback/ids'
import { eq } from 'drizzle-orm'
import { db as defaultDb, connectors } from '@/lib/server/db'
import { encrypt, decrypt } from '@/lib/server/encryption'
import { signOAuthState, verifyOAuthState } from '@/lib/server/auth/oauth-state'
import { createHash, randomBytes } from 'node:crypto'
import { buildCallbackUri } from '@/lib/server/integrations/oauth'
import { safePinnedFetch } from '@/lib/server/content/ssrf-guard'
import { logger } from '@/lib/server/logger'
import { ValidationError } from '@/lib/shared/errors'
import { CONNECTOR_SECRETS_PURPOSE, getConnector, type ConnectorRow } from './connectors.service'

const log = logger.child({ component: 'assistant-connectors-oauth' })
const REFRESH_BUFFER_MS = 5 * 60 * 1000

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export interface ConnectorOAuthSecrets {
  accessToken?: string
  refreshToken?: string
  expiresAt?: string
  clientId?: string
  clientSecret?: string
  tokenEndpoint?: string
  codeVerifier?: string
}

export class ConnectorOAuthRedirect extends Error {
  constructor(public readonly authorizationUrl: URL) {
    super('connector_oauth_redirect')
    this.name = 'ConnectorOAuthRedirect'
  }
}

function readSecrets(row: ConnectorRow): {
  bearerToken?: string
  oauth?: ConnectorOAuthSecrets
} {
  if (!row.secrets) return {}
  try {
    return JSON.parse(decrypt(row.secrets, CONNECTOR_SECRETS_PURPOSE)) as {
      bearerToken?: string
      oauth?: ConnectorOAuthSecrets
    }
  } catch (err) {
    log.error({ err }, 'connector secrets decryption failed')
    return {}
  }
}

async function writeSecrets(
  id: ConnectorId,
  next: { bearerToken?: string; oauth?: ConnectorOAuthSecrets },
  execDb = defaultDb
): Promise<void> {
  const ciphertext = encrypt(JSON.stringify(next), CONNECTOR_SECRETS_PURPOSE)
  await execDb
    .update(connectors)
    .set({ secrets: ciphertext, updatedAt: new Date() })
    .where(eq(connectors.id, id))
}

export function createConnectorOAuthProvider(
  row: ConnectorRow,
  request?: Request
): OAuthClientProvider {
  const stored = readSecrets(row)
  const oauth: ConnectorOAuthSecrets = { ...(stored.oauth ?? {}) }
  const persist = async () => {
    await writeSecrets(row.id, { ...stored, oauth })
  }
  const callback = request ? buildCallbackUri('connector', request) : '/oauth/connector/callback'

  return {
    get redirectUrl() {
      return callback
    },
    get clientMetadata() {
      return {
        client_name: 'Quackback',
        redirect_uris: [callback],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }
    },
    state() {
      return signOAuthState({ connectorId: row.id, createdAt: Date.now() })
    },
    clientInformation(): OAuthClientInformationMixed | undefined {
      if (!oauth.clientId) return undefined
      return { client_id: oauth.clientId, client_secret: oauth.clientSecret }
    },
    async saveClientInformation(info) {
      oauth.clientId = info.client_id
      oauth.clientSecret = 'client_secret' in info ? info.client_secret : oauth.clientSecret
      await persist()
    },
    tokens(): OAuthTokens | undefined {
      if (!oauth.accessToken) return undefined
      const expiresIn = oauth.expiresAt
        ? Math.max(0, Math.floor((new Date(oauth.expiresAt).getTime() - Date.now()) / 1000))
        : undefined
      return {
        access_token: oauth.accessToken,
        refresh_token: oauth.refreshToken,
        expires_in: expiresIn,
        token_type: 'Bearer',
      }
    },
    async saveTokens(tokens) {
      oauth.accessToken = tokens.access_token
      if (tokens.refresh_token) oauth.refreshToken = tokens.refresh_token
      if (typeof tokens.expires_in === 'number') {
        oauth.expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      }
      await persist()
    },
    async redirectToAuthorization(authorizationUrl) {
      throw new ConnectorOAuthRedirect(authorizationUrl)
    },
    async saveCodeVerifier(codeVerifier) {
      oauth.codeVerifier = codeVerifier
      await persist()
    },
    async codeVerifier() {
      if (!oauth.codeVerifier) {
        const pair = createPkcePair()
        oauth.codeVerifier = pair.verifier
        await persist()
      }
      return oauth.codeVerifier
    },
    async invalidateCredentials(scope) {
      if (scope === 'tokens' || scope === 'all') {
        delete oauth.accessToken
        delete oauth.refreshToken
        delete oauth.expiresAt
      }
      if (scope === 'verifier' || scope === 'all') delete oauth.codeVerifier
      if (scope === 'client' || scope === 'all') {
        delete oauth.clientId
        delete oauth.clientSecret
      }
      await persist()
    },
  }
}

export async function getValidConnectorAccessToken(
  row: ConnectorRow,
  execDb = defaultDb
): Promise<string | null> {
  const stored = readSecrets(row)
  const oauth = stored.oauth
  if (!oauth?.accessToken) return stored.bearerToken ?? null
  if (!oauth.refreshToken || !oauth.expiresAt || !oauth.tokenEndpoint) return oauth.accessToken

  const expiresAt = new Date(oauth.expiresAt).getTime()
  if (Date.now() < expiresAt - REFRESH_BUFFER_MS) return oauth.accessToken

  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: oauth.refreshToken,
    })
    if (oauth.clientId) body.set('client_id', oauth.clientId)
    const response = await safePinnedFetch(oauth.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!response.ok) throw new Error(`refresh failed (${response.status})`)
    const json = (await response.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }
    if (!json.access_token) throw new Error('refresh returned no access_token')
    const next: ConnectorOAuthSecrets = {
      ...oauth,
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? oauth.refreshToken,
      expiresAt:
        typeof json.expires_in === 'number'
          ? new Date(Date.now() + json.expires_in * 1000).toISOString()
          : oauth.expiresAt,
    }
    await writeSecrets(row.id, { ...stored, oauth: next }, execDb)
    return next.accessToken ?? null
  } catch (err) {
    log.warn({ err, id: row.id }, 'connector oauth refresh failed')
    await execDb
      .update(connectors)
      .set({
        status: 'error',
        lastError: 'Authorization expired',
        lastErrorAt: new Date(),
        errorCount: row.errorCount + 1,
        updatedAt: new Date(),
      })
      .where(eq(connectors.id, row.id))

    return oauth.accessToken
  }
}

export async function startConnectorOAuth(
  id: ConnectorId,
  request: Request
): Promise<{ authorizationUrl: string }> {
  const row = await getConnector(id)
  if (!row) throw new ValidationError('CONNECTOR_NOT_FOUND', 'Connector not found')
  const provider = createConnectorOAuthProvider(row, request)
  try {
    await auth(provider, { serverUrl: row.url, fetchFn: safePinnedFetch })
    throw new ValidationError('CONNECTOR_OAUTH_READY', 'This connector is already authorized.')
  } catch (err) {
    if (err instanceof ConnectorOAuthRedirect) {
      return { authorizationUrl: err.authorizationUrl.toString() }
    }
    throw err
  }
}

export async function finishConnectorOAuth(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const error = url.searchParams.get('error')
  const origin = `${url.protocol}//${url.host}`
  if (error) {
    log.warn({ error }, 'connector oauth callback error')
    return Response.redirect(`${origin}/admin/automation/connectors?oauth=error`, 302)
  }
  const state = url.searchParams.get('state')
  const code = url.searchParams.get('code')
  const parsed = state ? verifyOAuthState<{ connectorId?: string }>(state) : null
  if (!parsed?.connectorId || !code) {
    return Response.redirect(`${origin}/admin/automation/connectors?oauth=error`, 302)
  }
  const row = await getConnector(parsed.connectorId as ConnectorId)
  if (!row) {
    return Response.redirect(`${origin}/admin/automation/connectors?oauth=error`, 302)
  }
  const provider = createConnectorOAuthProvider(row, request)
  try {
    const transport = new StreamableHTTPClientTransport(new URL(row.url), {
      authProvider: provider,
      fetch: safePinnedFetch,
    })
    await transport.finishAuth(code)
    const { refreshConnector } = await import('./connectors.health')
    await refreshConnector(row.id)
    return Response.redirect(`${origin}/admin/automation/connectors/${row.id}?oauth=connected`, 302)
  } catch (err) {
    log.warn({ err, id: row.id }, 'connector oauth finish failed')
    return Response.redirect(`${origin}/admin/automation/connectors/${row.id}?oauth=error`, 302)
  }
}
