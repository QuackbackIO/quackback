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

const log = logger.child({ component: 'config' })

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

const configSchema = z.object({
  // Core
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  baseUrl: z.string().url(),
  port: envInt.default(3000),

  // Database
  databaseUrl: z.string().min(1),
  dbPoolMax: envInt.pipe(z.number().int().min(1).max(100)).optional(),
  dbIdleTimeout: envInt.pipe(z.number().int().min(1).max(3600)).default(20),

  // Auth
  secretKey: z.string().min(32, 'SECRET_KEY must be at least 32 characters'),
  // Rotation grace for OAuth refresh tokens (seconds). 0 disables healing
  // and restores strict single-use rotation. See auth/refresh-grace.ts.
  oauthRefreshGraceSeconds: envInt.default(7 * 24 * 60 * 60),

  // Redis (BullMQ background jobs)
  redisUrl: z.string().min(1),
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
  aiInboxTranslationModel: z.string().optional(),
  aiClassificationModel: z.string().optional(),
  aiRequireParameters: envBoolean,

  // Telemetry (optional)
  disableTelemetry: envBoolean,
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
    databaseUrl: process.env.DATABASE_URL,
    dbPoolMax: env('DB_POOL_MAX'),
    dbIdleTimeout: env('DB_IDLE_TIMEOUT'),

    // Auth
    secretKey: process.env.SECRET_KEY,
    oauthRefreshGraceSeconds: env('OAUTH_REFRESH_GRACE_SECONDS'),

    // Redis
    redisUrl: process.env.REDIS_URL,
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
  get baseUrl() {
    return loadConfig().baseUrl
  },
  get port() {
    return loadConfig().port
  },
  get databaseUrl() {
    return loadConfig().databaseUrl
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

  // Redis
  get redisUrl() {
    return loadConfig().redisUrl
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
