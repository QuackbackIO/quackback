import { isProductEnabled, type FeatureFlags } from '@/lib/server/domains/settings/settings.types'

export const SCALE_BRACKETS = ['0', '1-10', '11-50', '51-200', '200+'] as const
export type ScaleBracket = (typeof SCALE_BRACKETS)[number]

export const TELEMETRY_OUTCOMES = [
  'product_feedback',
  'customer_support',
  'help_center',
  'internal',
] as const
export type TelemetryOutcome = (typeof TELEMETRY_OUTCOMES)[number]

export const TELEMETRY_STARTER_RESOLUTIONS = [
  'created',
  'configured',
  'deferred',
  'unavailable',
] as const
export type TelemetryStarterResolution = (typeof TELEMETRY_STARTER_RESOLUTIONS)[number]

export const TELEMETRY_PRODUCT_IDS = [
  'feedback',
  'support',
  'helpCenter',
  'changelog',
  'status',
] as const
export type TelemetryProductId = (typeof TELEMETRY_PRODUCT_IDS)[number]

export type TelemetryProducts = Record<TelemetryProductId, boolean>

/** Keys that must never appear anywhere in a phone-home payload. */
export const FORBIDDEN_TELEMETRY_KEYS = new Set([
  'email',
  'url',
  'token',
  'content',
  'hostname',
  'origin',
  'canonicalorigin',
  'canonicaloriginhost',
  'widgetinstalledorigin',
  'widgetinstalledoriginhost',
  'siteorigin',
  'pathname',
])

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/
const URL_RE = /^https?:\/\//i

export function toScaleBracket(count: number): ScaleBracket {
  if (count <= 0) return '0'
  if (count <= 10) return '1-10'
  if (count <= 50) return '11-50'
  if (count <= 200) return '51-200'
  return '200+'
}

export function productsFromFlags(flags: FeatureFlags): TelemetryProducts {
  return {
    feedback: isProductEnabled(flags, 'feedback'),
    support: isProductEnabled(flags, 'support'),
    helpCenter: isProductEnabled(flags, 'helpCenter'),
    changelog: isProductEnabled(flags, 'changelog'),
    status: isProductEnabled(flags, 'status'),
  }
}

export function isScaleBracket(value: unknown): value is ScaleBracket {
  return typeof value === 'string' && (SCALE_BRACKETS as readonly string[]).includes(value)
}

/**
 * Fail closed: a payload that carries an identifier, a URL, or an unexpected
 * string does not leave the box. Walks objects only — no regex over the
 * serialized JSON, so a version like `0.13.2` is never mistaken for a URL.
 */
export function assertAnonymousTelemetry(value: unknown, path = 'payload'): void {
  if (value === null || value === undefined) return
  if (typeof value === 'boolean' || typeof value === 'number') return
  if (typeof value === 'string') {
    if (value.length > 64) throw new Error(`${path} exceeds 64 chars`)
    if (EMAIL_RE.test(value)) throw new Error(`${path} looks like an email`)
    if (URL_RE.test(value)) throw new Error(`${path} looks like a URL`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertAnonymousTelemetry(item, `${path}[${i}]`))
    return
  }
  if (typeof value !== 'object') throw new Error(`${path} has a non-anonymous type`)
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[_-]/g, '')
    if (FORBIDDEN_TELEMETRY_KEYS.has(normalized)) {
      throw new Error(`${path}.${key} is a forbidden field`)
    }
    assertAnonymousTelemetry(child, `${path}.${key}`)
  }
}
