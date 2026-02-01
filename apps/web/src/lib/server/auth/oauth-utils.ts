/**
 * OAuth Shared Utilities
 *
 * Common interfaces, constants, and utility functions used across
 * OAuth initiation and callback handling.
 */

import crypto from 'crypto'
import { config } from '@/lib/server/config'

/** OAuth state must be validated within 5 minutes */
export const STATE_EXPIRY_MS = 5 * 60 * 1000

/** Base OAuth state passed through OAuth flow (HMAC-signed) */
export interface OAuthState {
  provider: string
  workspace: string
  returnDomain: string
  callbackUrl: string
  popup: boolean
  type: 'portal' | 'team'
  ts: number
  codeVerifier: string
}

/** Extended OAuth state for OIDC flows with encrypted config */
export interface OIDCOAuthState extends OAuthState {
  oidcConfig: string
  nonce: string
}

/** Portable OIDC config encrypted in OAuth state (contains decrypted secret) */
export interface PortableOIDCConfig {
  issuer: string
  clientId: string
  clientSecret: string
  emailDomain?: string
  scopes?: string[]
  type: 'portal' | 'team'
}

/** User info extracted from OAuth provider */
export interface OAuthUserInfo {
  email: string
  name: string
  image: string | null
  providerId: string
}

function getProtocol(): string {
  return config.isProd ? 'https' : 'http'
}

export function buildCallbackUrl(headers: Headers, provider: string): string {
  const appDomain = process.env.CLOUD_APP_DOMAIN
  if (appDomain) {
    return `https://${appDomain}/api/auth/callback/${provider}`
  }

  const proto = headers.get('x-forwarded-proto') || 'https'
  const host = headers.get('host')
  return `${proto}://${host}/api/auth/callback/${provider}`
}

export function buildErrorRedirect(
  returnDomain: string,
  callbackUrl: string,
  error: string
): string {
  const url = new URL(callbackUrl, `${getProtocol()}://${returnDomain}`)
  url.searchParams.set('error', error)
  return url.toString()
}

export function buildCompletionUrl(returnDomain: string, transferToken: string): string {
  return `${getProtocol()}://${returnDomain}/api/auth/oauth-complete?token=${transferToken}`
}

export function isStateExpired(ts: number, expiryMs: number = STATE_EXPIRY_MS): boolean {
  return Date.now() - ts > expiryMs
}

/** Validate returnDomain is a legitimate tenant domain (prevents open redirect) */
export function isValidReturnDomain(returnDomain: string, workspace: string): boolean {
  if (config.isDev) return true

  const baseDomain = process.env.CLOUD_TENANT_BASE_DOMAIN
  if (baseDomain && returnDomain === `${workspace}.${baseDomain}`) {
    return true
  }

  const rootUrl = process.env.ROOT_URL
  if (rootUrl) {
    try {
      if (returnDomain === new URL(rootUrl).host) return true
    } catch {
      // Invalid ROOT_URL
    }
  }

  return false
}

/** Validate callbackUrl is a relative path (prevents redirect to external URLs) */
export function isValidCallbackUrl(callbackUrl: string): boolean {
  return (
    callbackUrl.startsWith('/') && !callbackUrl.startsWith('//') && !callbackUrl.includes('://')
  )
}

/** Normalize callbackUrl to a safe relative path */
export function normalizeCallbackUrl(callbackUrl: string): string {
  let normalized = callbackUrl.replace(/^https?:\/\/[^/]+/, '')
  if (!normalized.startsWith('/')) normalized = '/' + normalized
  return normalized.replace(/^\/\/+/, '/')
}

/** Generate PKCE code verifier (43-char base64url from 32 random bytes) */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url')
}

/** Generate PKCE code challenge (S256 method) */
export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

/** Generate cryptographic nonce for OIDC (prevents ID token replay) */
export function generateNonce(): string {
  return crypto.randomBytes(16).toString('base64url')
}

export interface UserInfoClaims {
  name?: string
  given_name?: string
  family_name?: string
  preferred_username?: string
  sub?: string
}

/** Build display name from OIDC claims (avoids email-like values for privacy) */
export function buildDisplayName(data: UserInfoClaims, fallback?: string): string {
  if (data.name && !data.name.includes('@')) {
    return data.name
  }
  if (data.given_name) {
    return data.family_name ? `${data.given_name} ${data.family_name}` : data.given_name
  }
  if (data.preferred_username && !data.preferred_username.includes('@')) {
    return data.preferred_username
  }
  if (data.sub) {
    return `User ${data.sub.slice(0, 8)}`
  }
  return fallback ?? 'Anonymous'
}
