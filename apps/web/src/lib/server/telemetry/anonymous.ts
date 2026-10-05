import { isProductEnabled, type FeatureFlags } from '@/lib/server/domains/settings/settings.types'

export const SCALE_BRACKETS = [
  '0',
  '1-10',
  '11-50',
  '51-200',
  '201-1000',
  '1001-10000',
  '10000+',
] as const
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
  if (!(count > 0)) return '0'
  if (count <= 10) return '1-10'
  if (count <= 50) return '11-50'
  if (count <= 200) return '51-200'
  if (count <= 1000) return '201-1000'
  if (count <= 10_000) return '1001-10000'
  return '10000+'
}

export const AGE_BRACKETS = ['<7d', '7-30d', '31-90d', '91-365d', '365d+'] as const
export type AgeBracket = (typeof AGE_BRACKETS)[number]

const DAY_MS = 86_400_000

/** How long ago the workspace was created, banded so it never dates the install. */
export function toAgeBracket(
  createdAt: Date | null | undefined,
  now = new Date()
): AgeBracket | null {
  if (!createdAt) return null
  const days = (now.getTime() - createdAt.getTime()) / DAY_MS
  if (days < 7) return '<7d'
  if (days <= 30) return '7-30d'
  if (days <= 90) return '31-90d'
  if (days <= 365) return '91-365d'
  return '365d+'
}

export type AiProvider = 'none' | 'openai' | 'openrouter' | 'azure' | 'google' | 'local' | 'other'

const PRIVATE_HOST_RE =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|host\.docker\.internal$)|\.local$/

/** `host` is `domain` or a subdomain of it, never merely a name ending in it. */
function onDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

/**
 * The model provider behind the configured OpenAI-compatible endpoint, as a
 * fixed label. The base URL itself never leaves the box: a self-hosted
 * gateway's hostname can name the company running it.
 */
export function aiProviderOf(apiKey: string | undefined, baseUrl: string | undefined): AiProvider {
  if (!apiKey) return 'none'
  if (!baseUrl) return 'openai'
  let host: string
  try {
    host = new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return 'other'
  }
  if (host === 'api.openai.com') return 'openai'
  if (onDomain(host, 'openrouter.ai')) return 'openrouter'
  if (onDomain(host, 'azure.com')) return 'azure'
  if (onDomain(host, 'googleapis.com')) return 'google'
  if (PRIVATE_HOST_RE.test(host)) return 'local'
  return 'other'
}

export const AI_FEATURES = [
  'assistant',
  'copilot',
  'helpCenter',
  'feedback',
  'inbox',
  'other',
] as const
export type AiFeature = (typeof AI_FEATURES)[number]

/** The product feature an `ai_usage_log.pipeline_step` belongs to. */
export function aiFeatureOf(pipelineStep: string): AiFeature {
  if (pipelineStep.startsWith('assistant')) return 'assistant'
  if (pipelineStep.startsWith('copilot')) return 'copilot'
  if (pipelineStep.startsWith('help_center') || pipelineStep.startsWith('kb_')) return 'helpCenter'
  if (
    [
      'extraction',
      'quality_gate',
      'interpretation',
      'merge',
      'sentiment',
      'summary',
      'post_autotag',
      'post_embedding',
    ].includes(pipelineStep)
  ) {
    return 'feedback'
  }
  if (
    pipelineStep.startsWith('conversation') ||
    pipelineStep.startsWith('inbox') ||
    pipelineStep.startsWith('ticket_') ||
    pipelineStep === 'classification' ||
    pipelineStep === 'spam_classification'
  ) {
    return 'inbox'
  }
  return 'other'
}

/**
 * Sign-in methods by kind. Built-in providers keep their id; any identity
 * provider an admin added under their own name reports as `oidc`, since that
 * name can identify the organisation.
 */
export function authMethodsOf(providerIds: string[], builtInIds: readonly string[]): string[] {
  const builtIn = new Set(builtInIds)
  return [...new Set(providerIds.map((id) => (builtIn.has(id) ? id : 'oidc')))].sort()
}

/** The values that appear in `allowed`, deduped and sorted; anything else is dropped. */
export function knownValues(values: string[], allowed: readonly string[]): string[] {
  const allow = new Set(allowed)
  return [...new Set(values.filter((v) => allow.has(v)))].sort()
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
