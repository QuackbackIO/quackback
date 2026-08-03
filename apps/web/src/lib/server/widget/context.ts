import { createHmac, timingSafeEqual } from 'crypto'
import {
  db,
  eq,
  and,
  isNull,
  widgetApplications,
  widgetEnvironmentProfiles,
  type WidgetProfileContentFilters,
  type WidgetProfileSupportConfig,
} from '@/lib/server/db'
import { config } from '@/lib/server/config'
import type { PublicWidgetConfig } from '@/lib/server/domains/settings'
import {
  getPublicWidgetConfig,
  publicLiveChatConfig,
} from '@/lib/server/domains/settings/settings.widget'
import { DEFAULT_LIVE_CHAT_CONFIG } from '@/lib/server/domains/settings/settings.types'
import { deepMerge } from '@/lib/server/domains/settings/settings.helpers'
import type { WidgetProfileId } from '@quackback/ids'

const TOKEN_DOMAIN_TAG = 'widget-context:v1\n'
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_ENVIRONMENT = 'default'

export interface WidgetContextSearch {
  applicationKey?: string
  environment?: string
  hostOrigin?: string
}

export interface WidgetContextTokenClaims {
  profileId?: WidgetProfileId
  applicationKey?: string
  environment?: string
  allowedInboxIds?: string[]
  ticketListScope?: string
  iat: number
  exp: number
}

export interface ResolvedWidgetContext {
  source: 'global' | 'profile' | 'disabled'
  profileId?: WidgetProfileId
  applicationKey?: string
  environment?: string
  publicConfig: PublicWidgetConfig
  contentFilters: WidgetProfileContentFilters
  supportConfig: WidgetProfileSupportConfig
  contextToken: string
  denialReason?: 'missing_profile' | 'profile_disabled' | 'origin_denied'
}

export class WidgetContextError extends Error {
  code: 'INVALID_WIDGET_CONTEXT' | 'WIDGET_PROFILE_NOT_FOUND' | 'WIDGET_PROFILE_DISABLED'

  constructor(code: WidgetContextError['code'], message: string) {
    super(message)
    this.name = 'WidgetContextError'
    this.code = code
  }
}

export interface WidgetRequestContext {
  claims: WidgetContextTokenClaims | null
  profileId?: WidgetProfileId
  applicationKey?: string
  environment?: string
  contentFilters: WidgetProfileContentFilters
  supportConfig: WidgetProfileSupportConfig
}

function normalizeIdentifier(value: string | undefined | null): string | undefined {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return undefined
  return normalized.replace(/[^a-z0-9._-]/g, '-')
}

function normalizeOrigin(value: string | undefined | null): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.origin
  } catch {
    try {
      return new URL(`https://${value}`).origin
    } catch {
      return undefined
    }
  }
}

interface ParsedOriginPattern {
  protocol: string
  hostname: string
  port: string
}

function parseOriginPattern(value: string): ParsedOriginPattern | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const hasProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
  let candidate = hasProtocol ? trimmed : `https://${trimmed}`
  let wildcardPort = false
  if (candidate.endsWith(':*')) {
    wildcardPort = true
    candidate = candidate.slice(0, -2)
  }

  try {
    const url = new URL(candidate)
    const hostname = url.hostname.toLowerCase()
    const localShorthand =
      !hasProtocol && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]')
    return {
      protocol: localShorthand ? '*' : url.protocol,
      hostname,
      port: wildcardPort ? '*' : url.port,
    }
  } catch {
    return null
  }
}

function requestOrigin(request: Request, fallback?: string): string | undefined {
  const origin = normalizeOrigin(request.headers.get('origin'))
  if (origin) return origin
  const referer = request.headers.get('referer')
  if (referer) {
    const parsed = normalizeOrigin(referer)
    if (parsed) return parsed
  }
  return normalizeOrigin(fallback)
}

function originMatches(pattern: string, origin: string): boolean {
  const patternOrigin = parseOriginPattern(pattern)
  const normalizedOrigin = normalizeOrigin(origin)
  if (!patternOrigin || !normalizedOrigin) return false
  const originUrl = new URL(normalizedOrigin)
  const originPort = originUrl.port

  if (
    patternOrigin.protocol !== '*' &&
    patternOrigin.port !== '*' &&
    `${patternOrigin.protocol}//${patternOrigin.hostname}${patternOrigin.port ? `:${patternOrigin.port}` : ''}` ===
      normalizedOrigin
  ) {
    return true
  }

  if (patternOrigin.protocol !== '*' && patternOrigin.protocol !== originUrl.protocol) return false

  const portMatches = patternOrigin.port === '*' || patternOrigin.port === originPort
  if (!portMatches) return false

  const originHost = originUrl.hostname.toLowerCase()

  if (patternOrigin.hostname.startsWith('*.')) {
    const suffix = patternOrigin.hostname.slice(2)
    return originHost.endsWith(`.${suffix}`) && originHost.length > suffix.length + 1
  }

  if (patternOrigin.hostname === '*') return true

  return patternOrigin.hostname === originHost
}

export function isOriginAllowed(allowedOrigins: string[], origin: string | undefined): boolean {
  if (allowedOrigins.length === 0) return true
  if (!origin) return false
  return allowedOrigins.some((pattern) => originMatches(pattern, origin))
}

function disabledContext(
  baseConfig: PublicWidgetConfig,
  reason: ResolvedWidgetContext['denialReason'],
  token: string,
  applicationKey?: string,
  environment?: string
): ResolvedWidgetContext {
  return {
    source: 'disabled',
    applicationKey,
    environment,
    publicConfig: { ...baseConfig, enabled: false },
    contentFilters: {},
    supportConfig: {},
    contextToken: token,
    denialReason: reason,
  }
}

function allowedInboxIds(supportConfig: WidgetProfileSupportConfig): string[] {
  const categories = supportConfig.categories ?? []
  return Array.from(
    new Set(
      categories
        .filter((category) => category.visible !== false)
        .map((category) => category.inboxId)
        .filter((id) => typeof id === 'string' && id.length > 0)
    )
  )
}

function signPayload(payload: string): string {
  return createHmac('sha256', config.secretKey)
    .update(TOKEN_DOMAIN_TAG + payload)
    .digest('base64url')
}

export function createWidgetContextToken(
  claims: Omit<WidgetContextTokenClaims, 'iat' | 'exp'>,
  ttlMs = TOKEN_TTL_MS
): string {
  const now = Date.now()
  const payload = JSON.stringify({ ...claims, iat: now, exp: now + ttlMs })
  const encodedPayload = Buffer.from(payload).toString('base64url')
  return `${encodedPayload}.${signPayload(payload)}`
}

export function verifyWidgetContextToken(
  token: string | null | undefined
): WidgetContextTokenClaims | null {
  if (!token) return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null

  const encodedPayload = token.slice(0, dot)
  const providedSig = token.slice(dot + 1)
  let payload: string
  try {
    payload = Buffer.from(encodedPayload, 'base64url').toString('utf8')
  } catch {
    return null
  }

  const expectedSig = signPayload(payload)
  const provided = Buffer.from(providedSig)
  const expected = Buffer.from(expectedSig)
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null

  try {
    const claims = JSON.parse(payload) as WidgetContextTokenClaims
    if (!claims.exp || typeof claims.exp !== 'number' || Date.now() > claims.exp) return null
    return claims
  } catch {
    return null
  }
}

export function verifyWidgetContextFromRequest(request: Request): WidgetContextTokenClaims | null {
  return verifyWidgetContextToken(request.headers.get('x-quackback-widget-context'))
}

export async function getWidgetRequestContext(request: Request): Promise<WidgetRequestContext> {
  const rawToken = request.headers.get('x-quackback-widget-context')
  if (!rawToken) {
    return {
      claims: null,
      contentFilters: {},
      supportConfig: {},
    }
  }

  const claims = verifyWidgetContextToken(rawToken)
  if (!claims) {
    throw new WidgetContextError('INVALID_WIDGET_CONTEXT', 'Invalid widget context')
  }

  if (!claims.profileId) {
    return {
      claims,
      applicationKey: claims.applicationKey,
      environment: claims.environment,
      contentFilters: {},
      supportConfig: {},
    }
  }

  const profile = await db.query.widgetEnvironmentProfiles.findFirst({
    where: and(
      eq(widgetEnvironmentProfiles.id, claims.profileId),
      isNull(widgetEnvironmentProfiles.archivedAt)
    ),
  })

  if (!profile) {
    throw new WidgetContextError('WIDGET_PROFILE_NOT_FOUND', 'Widget profile not found')
  }
  if (!profile.enabled) {
    throw new WidgetContextError('WIDGET_PROFILE_DISABLED', 'Widget profile is disabled')
  }

  return {
    claims,
    profileId: profile.id as WidgetProfileId,
    applicationKey: claims.applicationKey,
    environment: claims.environment,
    contentFilters: profile.contentFilters ?? {},
    supportConfig: profile.supportConfig ?? {},
  }
}

export async function resolveWidgetContext(
  request: Request,
  search: WidgetContextSearch
): Promise<ResolvedWidgetContext> {
  const baseConfig = await getPublicWidgetConfig()
  const applicationKey = normalizeIdentifier(search.applicationKey)
  const environment = normalizeIdentifier(search.environment)

  if (!applicationKey && !environment) {
    return {
      source: 'global',
      publicConfig: baseConfig,
      contentFilters: {},
      supportConfig: {},
      contextToken: createWidgetContextToken({}),
    }
  }

  const emptyToken = createWidgetContextToken({
    applicationKey,
    environment,
  })

  if (!applicationKey || !environment) {
    return disabledContext(baseConfig, 'missing_profile', emptyToken, applicationKey, environment)
  }

  const app = await db.query.widgetApplications.findFirst({
    where: and(eq(widgetApplications.key, applicationKey), isNull(widgetApplications.archivedAt)),
    with: {
      profiles: true,
    },
  })

  const profile =
    app?.profiles.find(
      (candidate) => candidate.archivedAt === null && candidate.environment === environment
    ) ??
    app?.profiles.find(
      (candidate) => candidate.archivedAt === null && candidate.environment === DEFAULT_ENVIRONMENT
    )

  if (!app || !profile) {
    return disabledContext(baseConfig, 'missing_profile', emptyToken, applicationKey, environment)
  }

  if (!profile.enabled) {
    return disabledContext(baseConfig, 'profile_disabled', emptyToken, applicationKey, environment)
  }

  const origin = requestOrigin(request, search.hostOrigin)
  if (!isOriginAllowed(profile.allowedOrigins ?? [], origin)) {
    return disabledContext(baseConfig, 'origin_denied', emptyToken, applicationKey, environment)
  }

  const overrides = profile.configOverrides ?? {}
  const mergedConfig = deepMerge(baseConfig, {
    ...overrides,
    ...(overrides.identifyVerification !== undefined
      ? { hmacRequired: overrides.identifyVerification }
      : {}),
    chat: overrides.chat
      ? publicLiveChatConfig({
          ...DEFAULT_LIVE_CHAT_CONFIG,
          ...(baseConfig.chat ?? {}),
          ...overrides.chat,
        })
      : baseConfig.chat,
  } as Partial<PublicWidgetConfig>)

  const supportConfig = profile.supportConfig ?? {}
  const contentFilters = profile.contentFilters ?? {}
  const token = createWidgetContextToken({
    profileId: profile.id as WidgetProfileId,
    applicationKey,
    environment: profile.environment,
    allowedInboxIds: allowedInboxIds(supportConfig),
    ticketListScope: supportConfig.ticketListScope ?? 'requester_owned',
  })

  return {
    source: 'profile',
    profileId: profile.id as WidgetProfileId,
    applicationKey,
    environment: profile.environment,
    publicConfig: mergedConfig,
    contentFilters,
    supportConfig,
    contextToken: token,
  }
}
