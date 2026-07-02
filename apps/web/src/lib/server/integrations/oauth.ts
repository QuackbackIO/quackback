/**
 * Shared OAuth helpers for integration OAuth flows.
 */

import { getRequestHeaders } from '@tanstack/react-start/server'

export const STATE_EXPIRY_MS = 5 * 60 * 1000

const DEFAULT_PUBLIC_PROTOCOL = 'https'

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim()
  return first || null
}

function normalizeProtocol(value: string | null | undefined): 'http' | 'https' | null {
  const protocol = value?.replace(/:$/, '').toLowerCase()
  return protocol === 'http' || protocol === 'https' ? protocol : null
}

function parseForwardedHeader(value: string | null): { host?: string; proto?: 'http' | 'https' } {
  const first = firstHeaderValue(value)
  if (!first) return {}

  const result: { host?: string; proto?: 'http' | 'https' } = {}
  for (const part of first.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=')
    const key = rawKey?.toLowerCase()
    const value = rawValue.join('=').trim().replace(/^"|"$/g, '')
    if (key === 'host' && value) result.host = value
    if (key === 'proto') {
      const proto = normalizeProtocol(value)
      if (proto) result.proto = proto
    }
  }
  return result
}

function originFromAbsoluteUrl(value: string | null | undefined): string | null {
  if (!value) return null

  try {
    const url = new URL(value)
    return normalizeProtocol(url.protocol) ? url.origin : null
  } catch {
    return null
  }
}

function originFromHost(
  host: string | null | undefined,
  protocol: 'http' | 'https'
): string | null {
  const cleanedHost = firstHeaderValue(host ?? null)
  if (!cleanedHost || cleanedHost.includes('/') || cleanedHost.includes('\\')) return null

  try {
    const url = new URL(`${protocol}://${cleanedHost}`)
    return url.origin
  } catch {
    return null
  }
}

function isPrivateTailnetOrigin(origin: string): boolean {
  try {
    return new URL(origin).hostname.toLowerCase().endsWith('.ts.net')
  } catch {
    return false
  }
}

function configuredBaseOrigin(): string | null {
  const baseUrl = process.env.BASE_URL
  if (!baseUrl) return null

  try {
    return new URL(baseUrl).origin
  } catch {
    return null
  }
}

function configuredReturnDomain(): string {
  const origin = configuredBaseOrigin()
  if (!origin) {
    throw new Error('BASE_URL is required to build OAuth redirect URLs')
  }
  return new URL(origin).host
}

export function getPublicOriginFromHeaders(headers: Headers, requestUrl?: string): string {
  const forwarded = parseForwardedHeader(headers.get('forwarded'))
  const configuredOrigin = configuredBaseOrigin()
  const forwardedProtocol =
    normalizeProtocol(firstHeaderValue(headers.get('x-forwarded-proto'))) ?? forwarded.proto
  const headerOrigin =
    originFromAbsoluteUrl(firstHeaderValue(headers.get('origin'))) ??
    originFromAbsoluteUrl(firstHeaderValue(headers.get('referer')))
  const requestOrigin = originFromAbsoluteUrl(requestUrl)
  const publicProtocol =
    forwardedProtocol ??
    normalizeProtocol(headerOrigin ? new URL(headerOrigin).protocol : null) ??
    normalizeProtocol(requestOrigin ? new URL(requestOrigin).protocol : null) ??
    DEFAULT_PUBLIC_PROTOCOL

  const forwardedOrigin =
    originFromHost(headers.get('x-forwarded-host'), publicProtocol) ??
    originFromHost(forwarded.host, publicProtocol)
  if (forwardedOrigin) {
    if (isPrivateTailnetOrigin(forwardedOrigin) && configuredOrigin) return configuredOrigin
    return forwardedOrigin
  }
  if (headerOrigin) return headerOrigin

  const hostOrigin = originFromHost(headers.get('host'), publicProtocol)
  if (hostOrigin) {
    if (isPrivateTailnetOrigin(hostOrigin) && configuredOrigin) return configuredOrigin
    return hostOrigin
  }

  return configuredOrigin ?? ''
}

export function getPublicOriginFromRequest(request: Request): string {
  return getPublicOriginFromHeaders(request.headers, request.url)
}

export function getOAuthReturnDomain(): string {
  try {
    const origin = getPublicOriginFromHeaders(getRequestHeaders())
    return new URL(origin).host
  } catch {
    return configuredReturnDomain()
  }
}

export function isSecureRequest(request: Request): boolean {
  const forwarded = parseForwardedHeader(request.headers.get('forwarded'))
  const protocol =
    normalizeProtocol(firstHeaderValue(request.headers.get('x-forwarded-proto'))) ??
    forwarded.proto ??
    normalizeProtocol(originFromAbsoluteUrl(request.url) ? new URL(request.url).protocol : null)
  return protocol === 'https'
}

export function getStateCookieName(integration: string, request: Request): string {
  const baseName = `${integration}_oauth_state`
  return isSecureRequest(request) ? `__Secure-${baseName}` : baseName
}

export function getStateCookieNameVariants(integration: string): string[] {
  const baseName = `${integration}_oauth_state`
  return [`__Secure-${baseName}`, baseName]
}

export function parseCookies(cookieHeader: string): Record<string, string> {
  if (!cookieHeader) return {}

  return Object.fromEntries(
    cookieHeader.split(';').map((cookie) => {
      const [key, ...rest] = cookie.split('=')
      return [key.trim(), rest.join('=').trim()]
    })
  )
}

export function buildCallbackUri(integration: string, request: Request): string {
  const origin = getPublicOriginFromRequest(request)
  return `${origin}/oauth/${integration}/callback`
}

export function redirectResponse(url: string, cookies?: string[]): Response {
  const headers = new Headers({ Location: url })
  cookies?.forEach((cookie) => headers.append('Set-Cookie', cookie))
  return new Response(null, { status: 302, headers })
}

export function createCookie(
  name: string,
  value: string,
  isSecure: boolean,
  maxAge: number
): string {
  const secureFlag = isSecure ? 'Secure; ' : ''
  return `${name}=${value}; HttpOnly; ${secureFlag}SameSite=Lax; Max-Age=${maxAge}; Path=/`
}

export function clearCookie(name: string, isSecure: boolean): string {
  return createCookie(name, '', isSecure, 0)
}

export function clearStateCookies(integration: string): string[] {
  const [secureName, baseName] = getStateCookieNameVariants(integration)
  return [clearCookie(secureName, true), clearCookie(baseName, false)]
}

/**
 * Validate that a domain is a valid return domain.
 * For self-hosted, all domains are considered valid.
 */
export function isValidTenantDomain(_domain: string): boolean {
  return true
}
