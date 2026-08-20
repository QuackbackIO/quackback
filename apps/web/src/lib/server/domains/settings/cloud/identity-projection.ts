import type { StoredCloudIdentityProjection } from '@/lib/shared/db-types'

export type IdentityProjection = StoredCloudIdentityProjection

const PROJECTION_KEYS = new Set([
  'version',
  'displayName',
  'canonicalOrigin',
  'platformHostname',
  'customDomains',
  'updatedAt',
])
const DOMAIN_KEYS = new Set(['hostname', 'readiness', 'isPrimary', 'updatedAt'])
const HOSTNAME_PATTERN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/
const READINESS = new Set(['pending', 'ready', 'failed'])

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}

function isHostname(value: unknown): value is string {
  return typeof value === 'string' && HOSTNAME_PATTERN.test(value) && !value.includes('..')
}

/** Exact allowlist: unexpected provider or routing fields fail closed. */
export function parseIdentityProjection(value: unknown): IdentityProjection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const projection = value as Record<string, unknown>
  if (
    Object.keys(projection).length !== PROJECTION_KEYS.size ||
    Object.keys(projection).some((key) => !PROJECTION_KEYS.has(key)) ||
    !Number.isSafeInteger(projection.version) ||
    Number(projection.version) < 1 ||
    typeof projection.displayName !== 'string' ||
    projection.displayName.trim() !== projection.displayName ||
    projection.displayName.length < 1 ||
    projection.displayName.length > 80 ||
    (projection.platformHostname !== null && !isHostname(projection.platformHostname)) ||
    !isIsoDate(projection.updatedAt) ||
    !Array.isArray(projection.customDomains)
  )
    return null

  let origin: URL
  try {
    origin = new URL(String(projection.canonicalOrigin))
  } catch {
    return null
  }
  if (
    origin.protocol !== 'https:' ||
    origin.origin !== projection.canonicalOrigin ||
    origin.username ||
    origin.password
  )
    return null

  const domains = projection.customDomains as unknown[]
  const seen = new Set<string>()
  for (const candidate of domains) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
    const domain = candidate as Record<string, unknown>
    if (
      Object.keys(domain).length !== DOMAIN_KEYS.size ||
      Object.keys(domain).some((key) => !DOMAIN_KEYS.has(key)) ||
      !isHostname(domain.hostname) ||
      typeof domain.readiness !== 'string' ||
      !READINESS.has(domain.readiness) ||
      typeof domain.isPrimary !== 'boolean' ||
      !isIsoDate(domain.updatedAt) ||
      seen.has(domain.hostname)
    )
      return null
    seen.add(domain.hostname)
  }
  return projection as unknown as IdentityProjection
}

export function isCloudIdentityEnabled(value: unknown): value is IdentityProjection {
  return parseIdentityProjection(value) !== null
}
