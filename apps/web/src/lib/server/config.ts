/**
 * Centralized configuration with Zod validation.
 *
 * This module provides type-safe access to environment variables at runtime.
 * It uses getter functions to defer reading process.env until the value is
 * actually needed, avoiding Vite's build-time inlining of process.env values.
 *
 * Usage:
 *   import { config } from '@/lib/server/config'
 *   const dbUrl = config.databaseUrl // reads at runtime, not build time
 */

import { z } from 'zod'
import { logger } from '@/lib/server/logger'
import { getCurrentTenant } from '@/lib/server/tenancy/tenant-context'

const log = logger.child({ component: 'config' })

/**
 * A hostname that is a pattern rather than a host.
 *
 * `deploy/railway-template.yml` sets `BASE_URL: https://${{RAILWAY_PUBLIC_DOMAIN}}`,
 * and the moment a wildcard custom domain is attached that variable becomes the
 * literal string `*.example.com`. `new URL()` accepts
 * it, so nothing downstream complains — it just produces email links, asset URLs
 * and cookie attributes for a host that does not exist.
 */
const WILDCARD_HOST_RE = /[*?]/

// =============================================================================
// Schema Helpers
// =============================================================================

/** Treat empty strings as undefined (common in Docker/compose env vars). */
const emptyToUndefined = (val: unknown) => (val === '' ? undefined : val)

/**
 * Parse boolean from env var string.
 * Rejects ambiguous values - only accepts: true/false, 1/0, or actual booleans.
 * Empty strings are treated as undefined.
 */
const envBoolean = z
  .preprocess(
    emptyToUndefined,
    z.union([
      z.literal('true').transform(() => true),
      z.literal('false').transform(() => false),
      z.literal('1').transform(() => true),
      z.literal('0').transform(() => false),
      z.boolean(),
    ])
  )
  .optional()

/**
 * Parse integer from env var string.
 * Rejects NaN and non-integer values.
 * Empty strings are treated as undefined.
 */
const envInt = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .transform((v, ctx) => {
      const num = parseInt(v, 10)
      if (isNaN(num)) {
        ctx.addIssue({ code: 'custom', message: 'Invalid integer' })
        return z.NEVER
      }
      return num
    })
    .or(z.number().int())
)

// =============================================================================
// Schema Definition (camelCase property names)
// =============================================================================

const configSchema = z
  .object({
    // Core
    nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
    baseUrl: z.string().url(),
    port: envInt.default(3000),

    // Database
    //
    // Optional because a pooled fleet has no fleet-wide database: the tenant
    // middleware resolves one per request from the Host header. `config.databaseUrl`
    // throws rather than returning undefined so the ~5 single-tenant callers keep
    // their `string` type and a pooled misuse is loud.
    databaseUrl: z.string().min(1).optional(),
    dbPoolMax: envInt.pipe(z.number().int().min(1).max(100)).optional(),
    dbIdleTimeout: envInt.pipe(z.number().int().min(1).max(3600)).default(20),

    // Tenancy
    //
    // `single` is byte-for-byte today's behaviour: one process, one DATABASE_URL.
    // `pooled` makes the `db` proxy resolve per request and refuse to serve
    // without an explicit tenant scope.
    tenancyMode: z.enum(['single', 'pooled']).default('single'),
    /** Control-plane Postgres holding cp_tenant_registry / cp_tenant_hostnames. */
    controlDatabaseUrl: z.string().min(1).optional(),
    /**
     * Connections per tenant pool. Small on purpose: a pooled instance holds N
     * tenant pools, so per-tenant socket counts multiply across the fleet.
     */
    tenantPoolMax: envInt.pipe(z.number().int().min(1).max(20)).default(3),
    /** Seconds a tenant pool may sit idle before it is closed. Hygiene only. */
    tenantPoolIdleSeconds: envInt.pipe(z.number().int().min(5).max(86_400)).default(3_600),
    /** LRU cap on live tenant pools per instance. */
    tenantPoolMaxEntries: envInt.pipe(z.number().int().min(1).max(500)).default(50),
    /** TTL for the in-process hostname → tenant record cache, milliseconds. */
    tenantRegistryTtlMs: envInt.pipe(z.number().int().min(0).max(600_000)).default(30_000),
    /**
     * The fleet root from which every tenant's `SECRET_KEY` is derived and every
     * tenant's storage credential is sealed (`tenancy/vendor/fleet-secrets.ts`).
     *
     * Belongs in a sealed platform variable, never in a tenant record. The 32-char
     * floor is enforced here as well as in the crypto because HKDF will stretch a
     * short root into something indistinguishable from a real key, so nothing
     * downstream can tell — the check has to happen where the value enters.
     */
    fleetRootKey: z
      .string()
      .min(32, 'QUACKBACK_FLEET_ROOT_KEY must be at least 32 characters')
      .optional(),

    // Auth
    secretKey: z.string().min(32, 'SECRET_KEY must be at least 32 characters'),
    // Rotation grace for OAuth refresh tokens (seconds). 0 disables healing
    // and restores strict single-use rotation. See auth/refresh-grace.ts.
    oauthRefreshGraceSeconds: envInt.default(7 * 24 * 60 * 60),

    trustedProxyHops: envInt.pipe(z.number().int().min(0).max(10)).default(0),

    // Email (all optional)
    emailFrom: z.string().optional(),
    emailSmtpHost: z.string().optional(),
    emailSmtpPort: envInt.optional(),
    emailSmtpUser: z.string().optional(),
    emailSmtpPass: z.string().optional(),
    emailSmtpSecure: envBoolean,
    emailResendApiKey: z.string().optional(),

    // S3 (optional)
    s3Endpoint: z.string().optional(),
    s3Bucket: z.string().optional(),
    s3Region: z.string().optional(),
    s3AccessKeyId: z.string().optional(),
    s3SecretAccessKey: z.string().optional(),
    s3ForcePathStyle: envBoolean,
    s3PublicUrl: z.string().optional(),
    s3Proxy: envBoolean,

    // AI (optional)
    openaiApiKey: z.string().optional(),
    openaiBaseUrl: z.string().optional(),
    aiChatModel: z.string().optional(),
    aiEmbeddingModel: z.string().optional(),
    aiSummaryModel: z.string().optional(),
    aiSentimentModel: z.string().optional(),
    aiExtractionModel: z.string().optional(),
    aiQualityGateModel: z.string().optional(),
    aiInterpretationModel: z.string().optional(),
    aiMergeModel: z.string().optional(),
    aiHelpCenterModel: z.string().optional(),
    aiHelpCenterTranslateModel: z.string().optional(),
    aiAssistantModel: z.string().optional(),
    aiAssistantVision: z.string().optional(),
    aiInboxTranslationModel: z.string().optional(),
    aiClassificationModel: z.string().optional(),
    aiRequireParameters: envBoolean,

    // Telemetry (optional)
    disableTelemetry: envBoolean,
  })
  .superRefine((cfg, ctx) => {
    // A wildcard is a routing pattern, never an origin. Refused in every mode:
    // there is no deployment in which `https://*.example.com` is a usable base
    // URL, and the symptom of accepting one is a dead link in a customer's
    // inbox rather than an error anyone sees.
    if (WILDCARD_HOST_RE.test(cfg.baseUrl)) {
      ctx.addIssue({
        code: 'custom',
        path: ['baseUrl'],
        message:
          `BASE_URL is ${cfg.baseUrl}, which is a wildcard pattern rather than an origin. ` +
          'Once a wildcard custom domain is attached, RAILWAY_PUBLIC_DOMAIN becomes ' +
          '`*.example.com`; under QUACKBACK_TENANCY=pooled the per-request origin comes ' +
          'from the tenant record, so set BASE_URL to a real fleet hostname.',
      })
    }

    // Exactly one database story per mode. A pooled fleet with a stray
    // DATABASE_URL is the dangerous shape — a missing tenant scope would
    // silently connect somewhere real — so pooled mode refuses to boot with one.
    if (cfg.tenancyMode === 'single' && !cfg.databaseUrl) {
      ctx.addIssue({ code: 'custom', path: ['databaseUrl'], message: 'DATABASE_URL is required' })
    }
    if (cfg.tenancyMode === 'pooled') {
      if (!cfg.controlDatabaseUrl) {
        ctx.addIssue({
          code: 'custom',
          path: ['controlDatabaseUrl'],
          message: 'QUACKBACK_CONTROL_DATABASE_URL is required when QUACKBACK_TENANCY=pooled',
        })
      }
      if (cfg.databaseUrl) {
        ctx.addIssue({
          code: 'custom',
          path: ['databaseUrl'],
          message:
            'DATABASE_URL must be unset when QUACKBACK_TENANCY=pooled — the database is resolved per request',
        })
      }
    }
  })

type Config = z.infer<typeof configSchema>

// =============================================================================
// Env → Config Mapping (explicit, greppable)
// =============================================================================

function buildConfigFromEnv(): unknown {
  // Empty strings → undefined so .optional() works with Docker/compose env vars
  const env = (key: string) => process.env[key] || undefined

  return {
    // Core
    nodeEnv: process.env.NODE_ENV,
    baseUrl: process.env.BASE_URL,
    port: env('PORT'),

    // Database
    databaseUrl: env('DATABASE_URL'),
    dbPoolMax: env('DB_POOL_MAX'),
    dbIdleTimeout: env('DB_IDLE_TIMEOUT'),

    // Tenancy
    tenancyMode: env('QUACKBACK_TENANCY'),
    controlDatabaseUrl: env('QUACKBACK_CONTROL_DATABASE_URL'),
    tenantPoolMax: env('TENANT_POOL_MAX'),
    tenantPoolIdleSeconds: env('TENANT_POOL_IDLE_SECONDS'),
    tenantPoolMaxEntries: env('TENANT_POOL_MAX_ENTRIES'),
    tenantRegistryTtlMs: env('TENANT_REGISTRY_TTL_MS'),
    fleetRootKey: env('QUACKBACK_FLEET_ROOT_KEY'),

    // Auth
    secretKey: process.env.SECRET_KEY,
    oauthRefreshGraceSeconds: env('OAUTH_REFRESH_GRACE_SECONDS'),

    trustedProxyHops: env('TRUSTED_PROXY_HOPS'),

    // Email
    emailFrom: env('EMAIL_FROM'),
    emailSmtpHost: env('EMAIL_SMTP_HOST'),
    emailSmtpPort: env('EMAIL_SMTP_PORT'),
    emailSmtpUser: env('EMAIL_SMTP_USER'),
    emailSmtpPass: env('EMAIL_SMTP_PASS'),
    emailSmtpSecure: env('EMAIL_SMTP_SECURE'),
    emailResendApiKey: env('EMAIL_RESEND_API_KEY'),

    // S3
    s3Endpoint: env('S3_ENDPOINT'),
    s3Bucket: env('S3_BUCKET'),
    s3Region: env('S3_REGION'),
    s3AccessKeyId: env('S3_ACCESS_KEY_ID'),
    s3SecretAccessKey: env('S3_SECRET_ACCESS_KEY'),
    s3ForcePathStyle: env('S3_FORCE_PATH_STYLE'),
    s3PublicUrl: env('S3_PUBLIC_URL'),
    s3Proxy: env('S3_PROXY'),

    // AI
    openaiApiKey: env('OPENAI_API_KEY'),
    openaiBaseUrl: env('OPENAI_BASE_URL'),
    aiChatModel: env('AI_CHAT_MODEL'),
    aiEmbeddingModel: env('AI_EMBEDDING_MODEL'),
    aiSummaryModel: env('AI_SUMMARY_MODEL'),
    aiSentimentModel: env('AI_SENTIMENT_MODEL'),
    aiExtractionModel: env('AI_EXTRACTION_MODEL'),
    aiQualityGateModel: env('AI_QUALITY_GATE_MODEL'),
    aiInterpretationModel: env('AI_INTERPRETATION_MODEL'),
    aiMergeModel: env('AI_MERGE_MODEL'),
    aiHelpCenterModel: env('AI_HELP_CENTER_MODEL'),
    aiHelpCenterTranslateModel: env('AI_HELP_CENTER_TRANSLATE_MODEL'),
    aiAssistantModel: env('AI_ASSISTANT_MODEL'),
    aiAssistantVision: env('AI_ASSISTANT_VISION'),
    aiInboxTranslationModel: env('AI_INBOX_TRANSLATION_MODEL'),
    aiClassificationModel: env('AI_CLASSIFICATION_MODEL'),
    aiRequireParameters: env('AI_REQUIRE_PARAMETERS'),

    // Telemetry
    disableTelemetry: env('DISABLE_TELEMETRY'),
  }
}

// =============================================================================
// Config Loading
// =============================================================================

let _config: Config | null = null

function isBuildTime(): boolean {
  return process.env.QUACKBACK_BUILD === '1'
}

function loadConfig(): Config {
  if (_config) return _config

  if (isBuildTime()) {
    throw new Error('Config not available during build')
  }

  const result = configSchema.safeParse(buildConfigFromEnv())

  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      code: i.code,
    }))
    log.error({ issues }, 'config validation failed')
    throw new Error('Configuration validation failed')
  }

  _config = result.data
  return _config
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Config object with lazy getters.
 * Validates on first access, caches result.
 *
 * Usage:
 *   config.databaseUrl     // string
 *   config.emailSmtpHost   // string | undefined
 *   config.isDev           // boolean
 */
export const config = {
  // Core
  get nodeEnv() {
    return loadConfig().nodeEnv
  },
  /**
   * The origin this request belongs to.
   *
   * Under pooled tenancy the fleet has no single origin: one process serves
   * many hostnames, and `BASE_URL` is the platform's own domain. Every absolute
   * URL the app produces resolves from here — email links, asset URLs,
   * `__QUACKBACK_URL__` in the widget SDK, OAuth callbacks, the MCP resource
   * metadata — as do better-auth's `trustedOrigins` and the cookie `secure`
   * flag. So a fleet-wide value means **every tenant emails links to another
   * tenant's hostname**.
   *
   * The tenant record's `routing.baseUrl` is the answer, and it is already
   * pinned to the tenant's primary hostname and validated to carry no path,
   * query or wildcard. Resolving it here rather than at ~56 call sites is
   * deliberate: a per-call-site fix is a list that goes stale on the next
   * absolute URL anyone writes.
   *
   * Outside a tenant scope (single-tenant installs, boot, fleet paths) this is
   * `BASE_URL` exactly as before.
   */
  get baseUrl() {
    return getCurrentTenant()?.routing.baseUrl ?? loadConfig().baseUrl
  },
  get port() {
    return loadConfig().port
  },
  /**
   * The fleet-wide database. Throws under pooled tenancy, where there is no
   * such thing — every caller must go through the request's tenant scope.
   */
  get databaseUrl() {
    const url = loadConfig().databaseUrl
    if (!url) {
      throw new Error(
        'DATABASE_URL is not configured. Under QUACKBACK_TENANCY=pooled the database is ' +
          'resolved per request from the tenant registry; use the tenant scope instead.'
      )
    }
    return url
  },
  get tenancyMode() {
    return loadConfig().tenancyMode
  },
  get isPooledTenancy() {
    return loadConfig().tenancyMode === 'pooled'
  },
  get controlDatabaseUrl() {
    return loadConfig().controlDatabaseUrl
  },
  get tenantPoolMax() {
    return loadConfig().tenantPoolMax
  },
  get tenantPoolIdleSeconds() {
    return loadConfig().tenantPoolIdleSeconds
  },
  get tenantPoolMaxEntries() {
    return loadConfig().tenantPoolMaxEntries
  },
  get tenantRegistryTtlMs() {
    return loadConfig().tenantRegistryTtlMs
  },
  get fleetRootKey() {
    return loadConfig().fleetRootKey
  },
  get dbPoolMax() {
    const configured = loadConfig().dbPoolMax
    if (configured) return configured
    return process.env.QUACKBACK_ROLE === 'worker' ? 20 : 10
  },
  get dbIdleTimeout() {
    return loadConfig().dbIdleTimeout
  },
  get secretKey() {
    return loadConfig().secretKey
  },
  get oauthRefreshGraceSeconds() {
    return loadConfig().oauthRefreshGraceSeconds
  },

  get trustedProxyHops() {
    return loadConfig().trustedProxyHops
  },

  // Email
  get emailFrom() {
    return loadConfig().emailFrom
  },
  get emailSmtpHost() {
    return loadConfig().emailSmtpHost
  },
  get emailSmtpPort() {
    return loadConfig().emailSmtpPort
  },
  get emailSmtpUser() {
    return loadConfig().emailSmtpUser
  },
  get emailSmtpPass() {
    return loadConfig().emailSmtpPass
  },
  get emailSmtpSecure() {
    return loadConfig().emailSmtpSecure
  },
  get emailResendApiKey() {
    return loadConfig().emailResendApiKey
  },

  // S3
  get s3Endpoint() {
    return loadConfig().s3Endpoint
  },
  get s3Bucket() {
    return loadConfig().s3Bucket
  },
  get s3Region() {
    return loadConfig().s3Region
  },
  get s3AccessKeyId() {
    return loadConfig().s3AccessKeyId
  },
  get s3SecretAccessKey() {
    return loadConfig().s3SecretAccessKey
  },
  get s3ForcePathStyle() {
    return loadConfig().s3ForcePathStyle
  },
  get s3PublicUrl() {
    return loadConfig().s3PublicUrl
  },
  get s3Proxy() {
    return loadConfig().s3Proxy
  },

  // AI
  get openaiApiKey() {
    return loadConfig().openaiApiKey
  },
  get openaiBaseUrl() {
    return loadConfig().openaiBaseUrl
  },
  get aiChatModel() {
    return loadConfig().aiChatModel
  },
  get aiEmbeddingModel() {
    return loadConfig().aiEmbeddingModel
  },
  get aiSummaryModel() {
    return loadConfig().aiSummaryModel
  },
  get aiSentimentModel() {
    return loadConfig().aiSentimentModel
  },
  get aiExtractionModel() {
    return loadConfig().aiExtractionModel
  },
  get aiQualityGateModel() {
    return loadConfig().aiQualityGateModel
  },
  get aiInterpretationModel() {
    return loadConfig().aiInterpretationModel
  },
  get aiMergeModel() {
    return loadConfig().aiMergeModel
  },
  get aiHelpCenterModel() {
    return loadConfig().aiHelpCenterModel
  },
  get aiHelpCenterTranslateModel() {
    return loadConfig().aiHelpCenterTranslateModel
  },
  get aiAssistantModel() {
    return loadConfig().aiAssistantModel
  },
  get aiAssistantVision() {
    return loadConfig().aiAssistantVision
  },
  get aiInboxTranslationModel() {
    return loadConfig().aiInboxTranslationModel
  },
  get aiClassificationModel() {
    return loadConfig().aiClassificationModel
  },
  get aiRequireParameters() {
    return loadConfig().aiRequireParameters
  },

  // Telemetry
  get disableTelemetry() {
    return loadConfig().disableTelemetry
  },

  // Help center
  get helpCenterDev() {
    return process.env.HELP_CENTER_DEV === 'true'
  },

  // Platform (OAuth-app) credential source.
  //   'db'  (default) — self-host: the integration_platform_credentials table + admin UI.
  //   'env' — managed cloud: shared app creds from INTEGRATION_<PROVIDER>_<FIELD> env
  //           (projected from OpenBao via ESO), like the CP's own STRIPE_SECRET_KEY.
  // Direct process.env read (like helpCenterDev) so it works without a full config load.
  get platformCredentialsSource(): 'db' | 'env' {
    return process.env.PLATFORM_CREDENTIALS_SOURCE === 'env' ? 'env' : 'db'
  },

  // Realtime chat transport, surfaced to clients via getWidgetCapabilitiesFn.
  //   'live' (default) — SSE stream at /api/chat/stream.
  //   'poll' — force the widget/portal onto the polling fallback for a
  //            deployment behind a proxy that buffers or drops event streams.
  // Direct process.env read (like helpCenterDev) so it works without a full config load.
  get chatTransportMode(): 'live' | 'poll' {
    return process.env.CHAT_TRANSPORT_MODE === 'poll' ? 'poll' : 'live'
  },

  // Convenience
  get isDev() {
    return this.nodeEnv === 'development'
  },
  get isProd() {
    return this.nodeEnv === 'production'
  },
  get isTest() {
    return this.nodeEnv === 'test'
  },
} as const

/** Validate every required runtime setting before traffic or workers start. */
export function validateRuntimeConfig(): void {
  if (isBuildTime()) return
  loadConfig()
}

/**
 * Get base URL, returns empty string during build.
 */
export function getBaseUrl(): string {
  try {
    return config.baseUrl
  } catch {
    return ''
  }
}

/**
 * Check if running in production.
 */
export function isProduction(): boolean {
  try {
    return config.isProd
  } catch {
    return false
  }
}

/**
 * Reset config cache (for testing).
 */
export function resetConfig(): void {
  _config = null
}

export type { Config }
