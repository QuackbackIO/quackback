import { getRequestHeaders } from '@tanstack/react-start/server'
import { getBaseUrl } from '@/lib/server/config'
import { getPublicOriginFromHeaders } from '@/lib/server/integrations/oauth'

const LOCAL_HOSTNAMES = new Set(['localhost', 'host.docker.internal', '0.0.0.0', '::1'])

function isLocalOrPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')

  if (
    LOCAL_HOSTNAMES.has(normalized) ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local')
  ) {
    return true
  }

  if (normalized.includes(':')) {
    return (
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:')
    )
  }

  const match = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!match) return false

  const octets = match.slice(1).map(Number)
  if (octets.some((n) => n > 255)) return false

  const [a, b] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  )
}

function isLocalOrPrivateUrl(value: string): boolean {
  try {
    return isLocalOrPrivateHostname(new URL(value).hostname)
  } catch {
    return true
  }
}

function isUsableExternalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    return url.protocol === 'https:' && !isLocalOrPrivateHostname(url.hostname)
  } catch {
    return false
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

export function getActiveRequestHeaders(): Headers | undefined {
  try {
    return getRequestHeaders()
  } catch {
    return undefined
  }
}

export function resolvePublicBaseUrl(
  requestHeaders: Headers | undefined = getActiveRequestHeaders()
): string {
  const configuredBaseUrl = trimTrailingSlash(getBaseUrl())

  if (!isLocalOrPrivateUrl(configuredBaseUrl)) {
    return configuredBaseUrl
  }

  try {
    const requestOrigin = requestHeaders ? getPublicOriginFromHeaders(requestHeaders) : ''
    if (requestOrigin && isUsableExternalOrigin(requestOrigin)) {
      return requestOrigin
    }
  } catch {
    // Fall back to the configured URL below.
  }

  return configuredBaseUrl
}

export function rewriteUrlToPublicBaseUrl(
  value: string,
  requestHeaders: Headers | undefined = getActiveRequestHeaders()
): string {
  const publicBaseUrl = resolvePublicBaseUrl(requestHeaders)

  try {
    const url = new URL(value)
    const baseUrl = new URL(publicBaseUrl)
    url.protocol = baseUrl.protocol
    url.hostname = baseUrl.hostname
    url.port = baseUrl.port
    return url.toString()
  } catch {
    return value
  }
}
