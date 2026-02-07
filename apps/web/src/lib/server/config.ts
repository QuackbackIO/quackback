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

  // Email (all optional)
  emailFrom: z.string().optional(),
  emailSmtpHost: z.string().optional(),
  emailSmtpPort: envInt.optional(),
  emailSmtpUser: z.string().optional(),
  emailSmtpPass: z.string().optional(),
  emailSmtpSecure: envBoolean,
  emailResendApiKey: z.string().optional(),

  // OAuth (optional pairs)
  githubClientId: z.string().optional(),
  githubClientSecret: z.string().optional(),
  googleClientId: z.string().optional(),
  googleClientSecret: z.string().optional(),

  // S3 (optional)
  s3Endpoint: z.string().optional(),
  s3Bucket: z.string().optional(),
  s3Region: z.string().optional(),
  s3AccessKeyId: z.string().optional(),
  s3SecretAccessKey: z.string().optional(),
  s3ForcePathStyle: envBoolean,
  s3PublicUrl: z.string().optional(),

  // Integrations (optional)
  slackClientId: z.string().optional(),
  slackClientSecret: z.string().optional(),
  discordClientId: z.string().optional(),
  discordClientSecret: z.string().optional(),
  discordBotToken: z.string().optional(),
  linearClientId: z.string().optional(),
  linearClientSecret: z.string().optional(),
  jiraClientId: z.string().optional(),
  jiraClientSecret: z.string().optional(),
  githubIntegrationClientId: z.string().optional(),
  githubIntegrationClientSecret: z.string().optional(),
  asanaClientId: z.string().optional(),
  asanaClientSecret: z.string().optional(),
  clickupClientId: z.string().optional(),
  clickupClientSecret: z.string().optional(),
  shortcutApiToken: z.string().optional(),
  intercomClientId: z.string().optional(),
  intercomClientSecret: z.string().optional(),
  zendeskClientId: z.string().optional(),
  zendeskClientSecret: z.string().optional(),
  hubspotClientId: z.string().optional(),
  hubspotClientSecret: z.string().optional(),
  teamsClientId: z.string().optional(),
  teamsClientSecret: z.string().optional(),

  // AI (optional)
  openaiApiKey: z.string().optional(),
  openaiBaseUrl: z.string().optional(),
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

    // Email
    emailFrom: process.env.EMAIL_FROM,
    emailSmtpHost: process.env.EMAIL_SMTP_HOST,
    emailSmtpPort: process.env.EMAIL_SMTP_PORT,
    emailSmtpUser: process.env.EMAIL_SMTP_USER,
    emailSmtpPass: process.env.EMAIL_SMTP_PASS,
    emailSmtpSecure: process.env.EMAIL_SMTP_SECURE,
    emailResendApiKey: process.env.EMAIL_RESEND_API_KEY,

    // OAuth
    githubClientId: process.env.GITHUB_CLIENT_ID,
    githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,

    // S3
    s3Endpoint: process.env.S3_ENDPOINT,
    s3Bucket: process.env.S3_BUCKET,
    s3Region: process.env.S3_REGION,
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE,
    s3PublicUrl: process.env.S3_PUBLIC_URL,

    // Integrations
    slackClientId: process.env.SLACK_CLIENT_ID,
    slackClientSecret: process.env.SLACK_CLIENT_SECRET,
    discordClientId: process.env.DISCORD_CLIENT_ID,
    discordClientSecret: process.env.DISCORD_CLIENT_SECRET,
    discordBotToken: process.env.DISCORD_BOT_TOKEN,
    linearClientId: process.env.LINEAR_CLIENT_ID,
    linearClientSecret: process.env.LINEAR_CLIENT_SECRET,
    jiraClientId: process.env.JIRA_CLIENT_ID,
    jiraClientSecret: process.env.JIRA_CLIENT_SECRET,
    githubIntegrationClientId: process.env.GITHUB_INTEGRATION_CLIENT_ID,
    githubIntegrationClientSecret: process.env.GITHUB_INTEGRATION_CLIENT_SECRET,
    asanaClientId: process.env.ASANA_CLIENT_ID,
    asanaClientSecret: process.env.ASANA_CLIENT_SECRET,
    clickupClientId: process.env.CLICKUP_CLIENT_ID,
    clickupClientSecret: process.env.CLICKUP_CLIENT_SECRET,
    shortcutApiToken: process.env.SHORTCUT_API_TOKEN,
    intercomClientId: process.env.INTERCOM_CLIENT_ID,
    intercomClientSecret: process.env.INTERCOM_CLIENT_SECRET,
    zendeskClientId: process.env.ZENDESK_CLIENT_ID,
    zendeskClientSecret: process.env.ZENDESK_CLIENT_SECRET,
    hubspotClientId: process.env.HUBSPOT_CLIENT_ID,
    hubspotClientSecret: process.env.HUBSPOT_CLIENT_SECRET,
    teamsClientId: process.env.TEAMS_CLIENT_ID,
    teamsClientSecret: process.env.TEAMS_CLIENT_SECRET,

    // AI
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiBaseUrl: process.env.OPENAI_BASE_URL,
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

  // OAuth
  get githubClientId() {
    return loadConfig().githubClientId
  },
  get githubClientSecret() {
    return loadConfig().githubClientSecret
  },
  get googleClientId() {
    return loadConfig().googleClientId
  },
  get googleClientSecret() {
    return loadConfig().googleClientSecret
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

  // Integrations
  get slackClientId() {
    return loadConfig().slackClientId
  },
  get slackClientSecret() {
    return loadConfig().slackClientSecret
  },
  get discordClientId() {
    return loadConfig().discordClientId
  },
  get discordClientSecret() {
    return loadConfig().discordClientSecret
  },
  get discordBotToken() {
    return loadConfig().discordBotToken
  },
  get linearClientId() {
    return loadConfig().linearClientId
  },
  get linearClientSecret() {
    return loadConfig().linearClientSecret
  },
  get jiraClientId() {
    return loadConfig().jiraClientId
  },
  get jiraClientSecret() {
    return loadConfig().jiraClientSecret
  },
  get githubIntegrationClientId() {
    return loadConfig().githubIntegrationClientId
  },
  get githubIntegrationClientSecret() {
    return loadConfig().githubIntegrationClientSecret
  },
  get asanaClientId() {
    return loadConfig().asanaClientId
  },
  get asanaClientSecret() {
    return loadConfig().asanaClientSecret
  },
  get clickupClientId() {
    return loadConfig().clickupClientId
  },
  get clickupClientSecret() {
    return loadConfig().clickupClientSecret
  },
  get shortcutApiToken() {
    return loadConfig().shortcutApiToken
  },
  get intercomClientId() {
    return loadConfig().intercomClientId
  },
  get intercomClientSecret() {
    return loadConfig().intercomClientSecret
  },
  get zendeskClientId() {
    return loadConfig().zendeskClientId
  },
  get zendeskClientSecret() {
    return loadConfig().zendeskClientSecret
  },
  get hubspotClientId() {
    return loadConfig().hubspotClientId
  },
  get hubspotClientSecret() {
    return loadConfig().hubspotClientSecret
  },
  get teamsClientId() {
    return loadConfig().teamsClientId
  },
  get teamsClientSecret() {
    return loadConfig().teamsClientSecret
  },

  // AI
  get openaiApiKey() {
    return loadConfig().openaiApiKey
  },
  get openaiBaseUrl() {
    return loadConfig().openaiBaseUrl
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
