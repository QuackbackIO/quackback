/**
 * OIDC Service - Handles tenant-specific OIDC provider operations
 *
 * This service manages:
 * - OIDC discovery metadata fetching and caching
 * - Client secret encryption/decryption
 * - OAuth authorization URL building
 * - Token exchange and user info retrieval
 */

import { encryptToken, decryptToken } from '@quackback/db'
import type { OIDCProviderConfig } from '@/lib/server/domains/settings/settings.types'
import { buildDisplayName } from './oauth-utils'

export interface OIDCDiscoveryMetadata {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint: string
  jwks_uri: string
  scopes_supported?: string[]
  response_types_supported?: string[]
  token_endpoint_auth_methods_supported?: string[]
}

export interface OIDCUserInfo {
  /** Subject identifier (unique user ID from IdP) */
  sub: string
  email: string
  name: string
  picture?: string
}

interface CacheEntry {
  metadata: OIDCDiscoveryMetadata
  expiresAt: number
}

/** In-memory discovery cache with 1hr TTL */
const discoveryCache = new Map<string, CacheEntry>()
const DISCOVERY_CACHE_TTL = 60 * 60 * 1000 // 1 hour

/**
 * Fetch OIDC discovery metadata from issuer's well-known endpoint.
 * Results are cached for 1 hour.
 *
 * @param issuer - The OIDC issuer URL (e.g., https://auth.acmecorp.com)
 * @returns Discovery metadata
 * @throws Error if discovery fails or required endpoints are missing
 */
export async function fetchOIDCDiscovery(issuer: string): Promise<OIDCDiscoveryMetadata> {
  // Check cache
  const cached = discoveryCache.get(issuer)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.metadata
  }

  // Normalize issuer URL (remove trailing slash)
  const normalizedIssuer = issuer.replace(/\/$/, '')
  const discoveryUrl = `${normalizedIssuer}/.well-known/openid-configuration`

  // Fetch with retry logic (3 attempts)
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(discoveryUrl, {
        headers: {
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`Discovery fetch failed: ${response.status} ${response.statusText}`)
      }

      const metadata = (await response.json()) as OIDCDiscoveryMetadata

      // Validate required endpoints
      if (!metadata.authorization_endpoint) {
        throw new Error('Discovery response missing authorization_endpoint')
      }
      if (!metadata.token_endpoint) {
        throw new Error('Discovery response missing token_endpoint')
      }
      if (!metadata.userinfo_endpoint) {
        throw new Error('Discovery response missing userinfo_endpoint')
      }

      // Cache the result
      discoveryCache.set(issuer, {
        metadata,
        expiresAt: Date.now() + DISCOVERY_CACHE_TTL,
      })

      return metadata
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < 3) {
        // Wait before retry (exponential backoff)
        await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt)))
      }
    }
  }

  throw lastError || new Error('Failed to fetch OIDC discovery')
}

export function encryptOIDCSecret(clientSecret: string, workspaceId: string): string {
  return encryptToken(clientSecret, `oidc:${workspaceId}`)
}

export function decryptOIDCSecret(encryptedSecret: string, workspaceId: string): string {
  return decryptToken(encryptedSecret, `oidc:${workspaceId}`)
}

export async function buildOIDCAuthUrl(
  config: OIDCProviderConfig,
  redirectUri: string,
  state: string,
  codeChallenge: string,
  nonce: string
): Promise<string> {
  const discovery = await fetchOIDCDiscovery(config.issuer)

  const url = new URL(discovery.authorization_endpoint)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', state)

  const scopes = config.scopes?.length ? config.scopes : ['openid', 'email', 'profile']
  url.searchParams.set('scope', scopes.join(' '))
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('nonce', nonce)

  return url.toString()
}

export async function exchangeOIDCCode(
  config: OIDCProviderConfig,
  code: string,
  redirectUri: string,
  workspaceId: string
): Promise<{ accessToken: string; idToken?: string } | { error: string }> {
  try {
    const discovery = await fetchOIDCDiscovery(config.issuer)
    const clientSecret = decryptOIDCSecret(config.clientSecretEncrypted, workspaceId)

    const response = await fetch(discovery.token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    })

    const data = (await response.json()) as {
      error?: string
      error_description?: string
      access_token?: string
      id_token?: string
    }

    if (data.error) {
      console.error(`[oidc] Token exchange error: ${data.error}`, data.error_description)
      return { error: data.error_description || data.error }
    }

    if (!data.access_token) {
      return { error: 'No access token received' }
    }

    return {
      accessToken: data.access_token,
      idToken: data.id_token,
    }
  } catch (error) {
    console.error('[oidc] Token exchange failed:', error)
    return { error: error instanceof Error ? error.message : 'Token exchange failed' }
  }
}

export async function getOIDCUserInfo(
  config: OIDCProviderConfig,
  accessToken: string
): Promise<OIDCUserInfo | { error: string }> {
  try {
    const discovery = await fetchOIDCDiscovery(config.issuer)

    const response = await fetch(discovery.userinfo_endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      return { error: `Userinfo request failed: ${response.status}` }
    }

    const data = (await response.json()) as {
      sub?: string
      email?: string
      name?: string
      given_name?: string
      family_name?: string
      picture?: string
      preferred_username?: string
    }

    if (!data.sub) {
      return { error: 'Missing sub claim in userinfo response' }
    }

    if (!data.email) {
      return { error: 'Missing email claim in userinfo response' }
    }

    const { generateUsername } = await import('./username-generator')
    const name = buildDisplayName(data, generateUsername())

    return {
      sub: data.sub,
      email: data.email.toLowerCase(),
      name,
      picture: data.picture,
    }
  } catch (error) {
    console.error('[oidc] Userinfo fetch failed:', error)
    return { error: error instanceof Error ? error.message : 'Userinfo fetch failed' }
  }
}

export function clearDiscoveryCache(): void {
  discoveryCache.clear()
}
