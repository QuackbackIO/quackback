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

// =============================================================================
// Schema Helpers
// =============================================================================

/**
 * Parse boolean from env var string.
 * Rejects ambiguous values - only accepts: true/false, 1/0, or actual booleans.
 */
const envBoolean = z
  .union([
    z.literal('true').transform(() => true),
    z.literal('false').transform(() => false),
    z.literal('1').transform(() => true),
    z.literal('0').transform(() => false),
    z.boolean(),
  ])
  .optional()

/**
 * Parse integer from env var string.
 * Rejects NaN and non-integer values.
 */
const envInt = z
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

  // Auth
  secretKey: z.string().min(32, 'SECRET_KEY must be at least 32 characters'),

  // Redis (BullMQ background jobs)
  redisUrl: z.string().min(1),

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

  // AI (optional)
  openaiApiKey: z.string().optional(),
  openaiBaseUrl: z.string().optional(),

  // Telemetry (optional)
  disableTelemetry: envBoolean,
})

type Config = z.infer<typeof configSchema>

// =============================================================================
// Env → Config Mapping (explicit, greppable)
// =============================================================================

function buildConfigFromEnv(): unknown {
  return {
    // Core
    nodeEnv: process.env.NODE_ENV,
    baseUrl: process.env.BASE_URL,
    port: process.env.PORT,

    // Database
    databaseUrl: process.env.DATABASE_URL,

    // Auth
    secretKey: process.env.SECRET_KEY,

    // Redis
    redisUrl: process.env.REDIS_URL,

    // Email
    emailFrom: process.env.EMAIL_FROM,
    emailSmtpHost: process.env.EMAIL_SMTP_HOST,
    emailSmtpPort: process.env.EMAIL_SMTP_PORT,
    emailSmtpUser: process.env.EMAIL_SMTP_USER,
    emailSmtpPass: process.env.EMAIL_SMTP_PASS,
    emailSmtpSecure: process.env.EMAIL_SMTP_SECURE,
    emailResendApiKey: process.env.EMAIL_RESEND_API_KEY,

    // S3
    s3Endpoint: process.env.S3_ENDPOINT,
    s3Bucket: process.env.S3_BUCKET,
    s3Region: process.env.S3_REGION,
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE,
    s3PublicUrl: process.env.S3_PUBLIC_URL,

    // AI
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiBaseUrl: process.env.OPENAI_BASE_URL,

    // Telemetry
    disableTelemetry: process.env.DISABLE_TELEMETRY,
  }
}

// =============================================================================
// Config Loading
// =============================================================================

let _config: Config | null = null

function isBuildTime(): boolean {
  return !process.env.SECRET_KEY && process.env.NODE_ENV !== 'test'
}

function loadConfig(): Config {
  if (_config) return _config

  if (isBuildTime()) {
    throw new Error('Config not available during build')
  }

  const result = configSchema.safeParse(buildConfigFromEnv())

  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    console.error(`[Config] Validation failed:\n${errors}`)
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
  get secretKey() {
    return loadConfig().secretKey
  },

  // Redis
  get redisUrl() {
    return loadConfig().redisUrl
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

  // AI
  get openaiApiKey() {
    return loadConfig().openaiApiKey
  },
  get openaiBaseUrl() {
    return loadConfig().openaiBaseUrl
  },

  // Telemetry
  get disableTelemetry() {
    return loadConfig().disableTelemetry
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
